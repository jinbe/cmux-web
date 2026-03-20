/**
 * Layout renderer — turns a SplitLayout tree into resizable DOM panes.
 * Each leaf node gets an xterm.js terminal instance.
 */

export class LayoutRenderer {
  /** @type {Map<string, { terminal: any, fitAddon: any, wrapper: HTMLElement }>} */
  #terminals = new Map();
  /** @type {string | null} */
  #focusedSurfaceId = null;
  /** @type {Function} */
  #onInput;
  /** @type {Function} */
  #onResize;
  /** @type {Function} */
  #onSplit;
  /** @type {Function} */
  #onClose;
  /** @type {Function} */
  #onFocus;
  /** @type {Function} */
  #onRatiosChanged;

  /**
   * @param {{ onInput: Function, onResize: Function, onSplit: Function, onClose: Function, onFocus: Function, onRatiosChanged: Function }} callbacks
   */
  constructor(callbacks) {
    this.#onInput = callbacks.onInput;
    this.#onResize = callbacks.onResize;
    this.#onSplit = callbacks.onSplit;
    this.#onClose = callbacks.onClose;
    this.#onFocus = callbacks.onFocus;
    this.#onRatiosChanged = callbacks.onRatiosChanged;
  }

  /**
   * Render a layout tree into the given container element.
   * @param {HTMLElement} container
   * @param {object} layout - SplitLayout tree
   * @param {object[]} surfaces - Array of surface objects
   */
  render(container, layout, surfaces) {
    // Preserve existing terminals where possible
    const surfaceMap = new Map(surfaces.map((s) => [s.id, s]));
    const usedSurfaceIds = new Set();
    this.#collectSurfaceIds(layout, usedSurfaceIds);

    // Remove terminals that no longer exist
    for (const [id, entry] of this.#terminals) {
      if (!usedSurfaceIds.has(id)) {
        entry.terminal.dispose();
        this.#terminals.delete(id);
      }
    }

    // Clear container and re-render
    container.innerHTML = "";
    const el = this.#renderNode(layout, surfaceMap);
    container.appendChild(el);

    // Fit all terminals after DOM is laid out
    requestAnimationFrame(() => {
      this.fitAll();
    });
  }

  /**
   * Write output data to a terminal.
   * @param {string} surfaceId
   * @param {string} data
   */
  write(surfaceId, data) {
    const entry = this.#terminals.get(surfaceId);
    if (entry) {
      entry.terminal.write(data);
    }
  }

  /**
   * Focus a specific terminal.
   * @param {string} surfaceId
   */
  focus(surfaceId) {
    this.#setFocus(surfaceId);
  }

  /**
   * Fit all terminals to their containers.
   */
  fitAll() {
    for (const [id, entry] of this.#terminals) {
      try {
        entry.fitAddon.fit();
      } catch {
        // Terminal might not be visible
      }
    }
  }

  /**
   * Get the focused surface ID.
   */
  get focusedSurfaceId() {
    return this.#focusedSurfaceId;
  }

  /**
   * Dispose of all terminals.
   */
  dispose() {
    for (const [, entry] of this.#terminals) {
      entry.terminal.dispose();
    }
    this.#terminals.clear();
  }

  // --- Internal ---

  #collectSurfaceIds(node, set) {
    if (node.type === "leaf") {
      set.add(node.surfaceId);
    } else {
      for (const child of node.children) {
        this.#collectSurfaceIds(child, set);
      }
    }
  }

  #renderNode(node, surfaceMap) {
    if (node.type === "leaf") {
      return this.#renderLeaf(node.surfaceId, surfaceMap.get(node.surfaceId));
    }

    const container = document.createElement("div");
    container.className = `split-container ${node.direction}`;

    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i];
      const childEl = this.#renderNode(child, surfaceMap);

      // Set flex basis from ratio
      const ratio = node.ratios[i] ?? 1 / node.children.length;
      childEl.style.flex = `${ratio} 1 0%`;

      container.appendChild(childEl);

      // Add resize handle between children (not after the last one)
      if (i < node.children.length - 1) {
        const handle = document.createElement("div");
        handle.className = "split-handle";
        handle.dataset.index = String(i);
        this.#attachResizeHandler(handle, container, node, i);
        container.appendChild(handle);
      }
    }

    return container;
  }

  #renderLeaf(surfaceId, surface) {
    const wrapper = document.createElement("div");
    wrapper.className = "surface-wrapper";
    wrapper.dataset.surfaceId = surfaceId;

    if (this.#focusedSurfaceId === surfaceId) {
      wrapper.classList.add("focused");
    }

    // Header bar
    const header = document.createElement("div");
    header.className = "surface-header";

    const title = document.createElement("span");
    title.className = "surface-title";
    title.textContent = surface?.title ?? "shell";

    const actions = document.createElement("div");
    actions.className = "surface-actions";

    const splitH = document.createElement("span");
    splitH.className = "surface-action";
    splitH.textContent = "⇥";
    splitH.title = "Split right";
    splitH.addEventListener("click", (e) => {
      e.stopPropagation();
      this.#onSplit(surfaceId, "right");
    });

    const splitV = document.createElement("span");
    splitV.className = "surface-action";
    splitV.textContent = "⇤";
    splitV.title = "Split down";
    splitV.addEventListener("click", (e) => {
      e.stopPropagation();
      this.#onSplit(surfaceId, "down");
    });

    const close = document.createElement("span");
    close.className = "surface-action";
    close.textContent = "✕";
    close.title = "Close";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      this.#onClose(surfaceId);
    });

    actions.append(splitH, splitV, close);
    header.append(title, actions);

    // Terminal container
    const termContainer = document.createElement("div");
    termContainer.className = "terminal-container";

    wrapper.append(header, termContainer);

    // Create or reuse terminal
    let entry = this.#terminals.get(surfaceId);
    if (!entry) {
      entry = this.#createTerminal(surfaceId, termContainer);
      this.#terminals.set(surfaceId, entry);
    } else {
      // Re-attach existing terminal to new DOM
      entry.wrapper = wrapper;
      termContainer.appendChild(entry.terminal.element);
    }

    // Focus handling
    wrapper.addEventListener("mousedown", () => {
      this.#setFocus(surfaceId);
    });

    entry.wrapper = wrapper;

    return wrapper;
  }

  #createTerminal(surfaceId, container) {
    // xterm.js UMD globals
    const Terminal = window.Terminal;
    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      lineHeight: 1.2,
      theme: {
        background: "#1a1b26",
        foreground: "#c0caf5",
        cursor: "#c0caf5",
        cursorAccent: "#1a1b26",
        selectionBackground: "#33467c",
        selectionForeground: "#c0caf5",
        black: "#15161e",
        red: "#f7768e",
        green: "#9ece6a",
        yellow: "#e0af68",
        blue: "#7aa2f7",
        magenta: "#bb9af7",
        cyan: "#7dcfff",
        white: "#a9b1d6",
        brightBlack: "#414868",
        brightRed: "#f7768e",
        brightGreen: "#9ece6a",
        brightYellow: "#e0af68",
        brightBlue: "#7aa2f7",
        brightMagenta: "#bb9af7",
        brightCyan: "#7dcfff",
        brightWhite: "#c0caf5",
      },
      scrollback: 10000,
      allowProposedApi: true,
    });

    const fitAddon = new window.FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);

    const webLinksAddon = new window.WebLinksAddon.WebLinksAddon();
    terminal.loadAddon(webLinksAddon);

    terminal.open(container);

    // Wire input
    terminal.onData((data) => {
      this.#onInput(surfaceId, data);
    });

    // Wire resize
    terminal.onResize(({ cols, rows }) => {
      this.#onResize(surfaceId, cols, rows);
    });

    // Auto-focus first terminal
    if (!this.#focusedSurfaceId) {
      this.#focusedSurfaceId = surfaceId;
    }

    const wrapper = container.parentElement;
    return { terminal, fitAddon, wrapper };
  }

  #setFocus(surfaceId) {
    // Remove old focus
    if (this.#focusedSurfaceId) {
      const oldEntry = this.#terminals.get(this.#focusedSurfaceId);
      if (oldEntry?.wrapper) {
        oldEntry.wrapper.classList.remove("focused");
      }
    }

    this.#focusedSurfaceId = surfaceId;

    const entry = this.#terminals.get(surfaceId);
    if (entry) {
      entry.wrapper?.classList.add("focused");
      entry.terminal.focus();
    }

    this.#onFocus(surfaceId);
  }

  #attachResizeHandler(handle, container, node, index) {
    let startPos = 0;
    let startSizes = [];
    let totalSize = 0;

    const onMouseDown = (e) => {
      e.preventDefault();
      handle.classList.add("dragging");

      const isHorizontal = node.direction === "horizontal";
      startPos = isHorizontal ? e.clientX : e.clientY;

      // Get current pixel sizes of children (skip handles)
      const children = Array.from(container.children).filter(
        (el) => !el.classList.contains("split-handle")
      );
      startSizes = children.map((el) =>
        isHorizontal ? el.getBoundingClientRect().width : el.getBoundingClientRect().height
      );
      totalSize = startSizes.reduce((a, b) => a + b, 0);

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const onMouseMove = (e) => {
      const isHorizontal = node.direction === "horizontal";
      const currentPos = isHorizontal ? e.clientX : e.clientY;
      const delta = currentPos - startPos;

      const newSizes = [...startSizes];
      const minSize = 50;

      newSizes[index] = Math.max(minSize, startSizes[index] + delta);
      newSizes[index + 1] = Math.max(minSize, startSizes[index + 1] - delta);

      // Convert back to ratios
      const newRatios = newSizes.map((s) => s / totalSize);

      // Apply immediately via flex
      const children = Array.from(container.children).filter(
        (el) => !el.classList.contains("split-handle")
      );
      for (let i = 0; i < children.length; i++) {
        children[i].style.flex = `${newRatios[i]} 1 0%`;
      }

      // Fit terminals in affected panes
      this.fitAll();
    };

    const onMouseUp = () => {
      handle.classList.remove("dragging");
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);

      // Report final ratios to server
      const isHorizontal = node.direction === "horizontal";
      const children = Array.from(container.children).filter(
        (el) => !el.classList.contains("split-handle")
      );
      const sizes = children.map((el) =>
        isHorizontal ? el.getBoundingClientRect().width : el.getBoundingClientRect().height
      );
      const total = sizes.reduce((a, b) => a + b, 0);
      const ratios = sizes.map((s) => s / total);

      // Find a surface ID in the first child to identify this split
      const firstLeaf = children[0]?.querySelector("[data-surface-id]");
      if (firstLeaf) {
        this.#onRatiosChanged(firstLeaf.dataset.surfaceId, ratios);
      }
    };

    handle.addEventListener("mousedown", onMouseDown);
  }
}
