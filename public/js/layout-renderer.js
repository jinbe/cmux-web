/**
 * Layout renderer — turns a SplitLayout tree into resizable DOM panes.
 * Each leaf node gets an xterm.js terminal instance.
 *
 * Supports both mouse and touch for resize handles.
 */

const MOBILE_BREAKPOINT_PX = 768;
const MOBILE_FONT_SIZE = 12;
const DESKTOP_FONT_SIZE = 13;

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

    container.innerHTML = "";
    const el = this.#renderNode(layout, surfaceMap);
    container.appendChild(el);

    requestAnimationFrame(() => {
      this.fitAll();
    });
  }

  /**
   * Write output data to a terminal.
   */
  write(surfaceId, data) {
    const entry = this.#terminals.get(surfaceId);
    if (entry) {
      entry.terminal.write(data);
    }
  }

  /**
   * Focus a specific terminal.
   */
  focus(surfaceId) {
    this.#setFocus(surfaceId);
  }

  /**
   * Fit all terminals to their containers.
   */
  fitAll() {
    for (const [, entry] of this.#terminals) {
      try {
        entry.fitAddon.fit();
      } catch {
        // Terminal might not be visible
      }
    }
  }

  get focusedSurfaceId() {
    return this.#focusedSurfaceId;
  }

  dispose() {
    for (const [, entry] of this.#terminals) {
      entry.terminal.dispose();
    }
    this.#terminals.clear();
  }

  // --- Internal ---

  #isMobile() {
    return window.innerWidth <= MOBILE_BREAKPOINT_PX;
  }

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

      const ratio = node.ratios[i] ?? 1 / node.children.length;
      childEl.style.flex = `${ratio} 1 0%`;

      container.appendChild(childEl);

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

    const termContainer = document.createElement("div");
    termContainer.className = "terminal-container";

    wrapper.append(header, termContainer);

    let entry = this.#terminals.get(surfaceId);
    if (!entry) {
      entry = this.#createTerminal(surfaceId, termContainer);
      this.#terminals.set(surfaceId, entry);
    } else {
      entry.wrapper = wrapper;
      termContainer.appendChild(entry.terminal.element);
    }

    // Focus handling — both mouse and touch
    const focusHandler = () => this.#setFocus(surfaceId);
    wrapper.addEventListener("mousedown", focusHandler);
    wrapper.addEventListener("touchstart", focusHandler, { passive: true });

    entry.wrapper = wrapper;

    return wrapper;
  }

  #createTerminal(surfaceId, container) {
    const Terminal = window.Terminal;
    const fontSize = this.#isMobile() ? MOBILE_FONT_SIZE : DESKTOP_FONT_SIZE;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: "bar",
      fontSize,
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
      scrollback: 5000,
      allowProposedApi: true,
      // Mobile: allow touch scrolling in terminal
      overviewRulerWidth: 0,
    });

    const fitAddon = new window.FitAddon.FitAddon();
    terminal.loadAddon(fitAddon);

    const webLinksAddon = new window.WebLinksAddon.WebLinksAddon();
    terminal.loadAddon(webLinksAddon);

    terminal.open(container);

    terminal.onData((data) => {
      this.#onInput(surfaceId, data);
    });

    terminal.onResize(({ cols, rows }) => {
      this.#onResize(surfaceId, cols, rows);
    });

    if (!this.#focusedSurfaceId) {
      this.#focusedSurfaceId = surfaceId;
    }

    const wrapper = container.parentElement;
    return { terminal, fitAddon, wrapper };
  }

  #setFocus(surfaceId) {
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

  /**
   * Attach mouse + touch resize handler to a split handle.
   */
  #attachResizeHandler(handle, container, node, index) {
    let startPos = 0;
    let startSizes = [];
    let totalSize = 0;
    let isHorizontal = false;
    const MIN_PANE_SIZE_PX = 50;

    // --- Shared logic ---

    const startDrag = (clientX, clientY) => {
      handle.classList.add("dragging");

      // On mobile, CSS forces horizontal splits to become vertical
      const computedStyle = window.getComputedStyle(container);
      const isActuallyHorizontal = computedStyle.flexDirection === "row";
      isHorizontal = isActuallyHorizontal;

      startPos = isHorizontal ? clientX : clientY;

      const children = Array.from(container.children).filter(
        (el) => !el.classList.contains("split-handle")
      );
      startSizes = children.map((el) =>
        isHorizontal ? el.getBoundingClientRect().width : el.getBoundingClientRect().height
      );
      totalSize = startSizes.reduce((a, b) => a + b, 0);
    };

    const moveDrag = (clientX, clientY) => {
      const currentPos = isHorizontal ? clientX : clientY;
      const delta = currentPos - startPos;

      const newSizes = [...startSizes];
      newSizes[index] = Math.max(MIN_PANE_SIZE_PX, startSizes[index] + delta);
      newSizes[index + 1] = Math.max(MIN_PANE_SIZE_PX, startSizes[index + 1] - delta);

      const newRatios = newSizes.map((s) => s / totalSize);

      const children = Array.from(container.children).filter(
        (el) => !el.classList.contains("split-handle")
      );
      for (let i = 0; i < children.length; i++) {
        children[i].style.flex = `${newRatios[i]} 1 0%`;
      }

      this.fitAll();
    };

    const endDrag = () => {
      handle.classList.remove("dragging");

      const children = Array.from(container.children).filter(
        (el) => !el.classList.contains("split-handle")
      );
      const sizes = children.map((el) =>
        isHorizontal ? el.getBoundingClientRect().width : el.getBoundingClientRect().height
      );
      const total = sizes.reduce((a, b) => a + b, 0);
      const ratios = sizes.map((s) => s / total);

      const firstLeaf = children[0]?.querySelector("[data-surface-id]");
      if (firstLeaf) {
        this.#onRatiosChanged(firstLeaf.dataset.surfaceId, ratios);
      }
    };

    // --- Mouse events ---

    const onMouseDown = (e) => {
      e.preventDefault();
      startDrag(e.clientX, e.clientY);
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    };

    const onMouseMove = (e) => {
      moveDrag(e.clientX, e.clientY);
    };

    const onMouseUp = () => {
      endDrag();
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    handle.addEventListener("mousedown", onMouseDown);

    // --- Touch events ---

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      startDrag(touch.clientX, touch.clientY);
      handle.addEventListener("touchmove", onTouchMove, { passive: false });
      handle.addEventListener("touchend", onTouchEnd);
      handle.addEventListener("touchcancel", onTouchEnd);
    };

    const onTouchMove = (e) => {
      if (e.touches.length !== 1) return;
      e.preventDefault();
      const touch = e.touches[0];
      moveDrag(touch.clientX, touch.clientY);
    };

    const onTouchEnd = () => {
      endDrag();
      handle.removeEventListener("touchmove", onTouchMove);
      handle.removeEventListener("touchend", onTouchEnd);
      handle.removeEventListener("touchcancel", onTouchEnd);
    };

    handle.addEventListener("touchstart", onTouchStart, { passive: false });
  }
}
