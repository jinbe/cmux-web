/**
 * Moravec web client — main application entry point.
 * Orchestrates WebSocket connection, workspace management, and layout rendering.
 */

import { WsClient } from "./ws-client.js";
import { LayoutRenderer } from "./layout-renderer.js";

// --- State ---

/** @type {Map<string, object>} */
const workspaces = new Map();
let activeWorkspaceId = null;
/** @type {Map<string, LayoutRenderer>} */
const renderers = new Map();

// --- DOM refs ---
const workspaceTabsEl = document.getElementById("workspace-tabs");
const workspaceContainerEl = document.getElementById("workspace-container");
const addWorkspaceBtn = document.getElementById("add-workspace");

// --- WebSocket client ---
const ws = new WsClient();

// --- Initialise ---

async function init() {
  await ws.connect();

  // Wire up server events
  ws.on("state.sync", handleStateSync);
  ws.on("workspace.updated", handleWorkspaceUpdated);
  ws.on("surface.output", handleSurfaceOutput);
  ws.on("surface.exit", handleSurfaceExit);
  ws.on("surface.title", handleSurfaceTitle);

  // Wire up UI events
  addWorkspaceBtn.addEventListener("click", createWorkspace);

  // Keyboard shortcuts
  document.addEventListener("keydown", handleKeyDown);

  // Window resize → refit terminals
  window.addEventListener("resize", () => {
    for (const renderer of renderers.values()) {
      renderer.fitAll();
    }
  });
}

// --- Server event handlers ---

function handleStateSync(msg) {
  workspaces.clear();
  for (const ws of msg.workspaces) {
    workspaces.set(ws.id, ws);
  }
  activeWorkspaceId = msg.activeWorkspaceId;
  renderSidebar();
  renderAllWorkspaces();
}

function handleWorkspaceUpdated(msg) {
  const ws = msg.workspace;
  workspaces.set(ws.id, ws);
  renderSidebar();
  renderWorkspace(ws.id);
}

function handleSurfaceOutput(msg) {
  // Route output to the correct terminal
  for (const renderer of renderers.values()) {
    renderer.write(msg.surfaceId, msg.data);
  }
}

function handleSurfaceExit(msg) {
  console.log(`[moravec] Surface ${msg.surfaceId} exited with code ${msg.exitCode}`);
  // The server will send a workspace update or state sync
}

function handleSurfaceTitle(msg) {
  // TODO: update title in UI
}

// --- UI rendering ---

function renderSidebar() {
  workspaceTabsEl.innerHTML = "";
  let index = 1;
  for (const [id, ws] of workspaces) {
    const tab = document.createElement("div");
    tab.className = `workspace-tab${id === activeWorkspaceId ? " active" : ""}`;
    tab.dataset.workspaceId = id;

    const indexSpan = document.createElement("span");
    indexSpan.className = "tab-index";
    indexSpan.textContent = String(index);

    const nameSpan = document.createElement("span");
    nameSpan.className = "tab-name";
    nameSpan.textContent = ws.name;

    const closeSpan = document.createElement("span");
    closeSpan.className = "tab-close";
    closeSpan.textContent = "×";
    closeSpan.addEventListener("click", (e) => {
      e.stopPropagation();
      closeWorkspace(id);
    });

    tab.append(indexSpan, nameSpan, closeSpan);
    tab.addEventListener("click", () => selectWorkspace(id));
    workspaceTabsEl.appendChild(tab);
    index++;
  }
}

function renderAllWorkspaces() {
  // Clean up renderers for workspaces that no longer exist
  for (const [id, renderer] of renderers) {
    if (!workspaces.has(id)) {
      renderer.dispose();
      renderers.delete(id);
    }
  }

  // Clear container
  workspaceContainerEl.innerHTML = "";

  for (const [id, ws] of workspaces) {
    renderWorkspace(id);
  }
}

function renderWorkspace(workspaceId) {
  const wsData = workspaces.get(workspaceId);
  if (!wsData) return;

  // Find or create workspace view element
  let viewEl = workspaceContainerEl.querySelector(`[data-workspace-id="${workspaceId}"]`);
  if (!viewEl) {
    viewEl = document.createElement("div");
    viewEl.className = "workspace-view";
    viewEl.dataset.workspaceId = workspaceId;
    workspaceContainerEl.appendChild(viewEl);
  }

  // Show/hide based on active workspace
  viewEl.classList.toggle("active", workspaceId === activeWorkspaceId);

  // Create or reuse layout renderer
  let renderer = renderers.get(workspaceId);
  if (!renderer) {
    renderer = new LayoutRenderer({
      onInput: (surfaceId, data) => {
        ws.send("surface.input", { surfaceId, data });
      },
      onResize: (surfaceId, cols, rows) => {
        ws.send("surface.resize", { surfaceId, cols, rows });
      },
      onSplit: (surfaceId, direction) => {
        ws.request("surface.split", { surfaceId, direction });
      },
      onClose: (surfaceId) => {
        ws.request("surface.close", { surfaceId });
      },
      onFocus: (surfaceId) => {
        // Could track focus server-side if needed
      },
      onRatiosChanged: (surfaceId, ratios) => {
        ws.send("surface.set_ratios", { surfaceId, ratios });
      },
    });
    renderers.set(workspaceId, renderer);
  }

  renderer.render(viewEl, wsData.layout, wsData.surfaces);
}

// --- Actions ---

async function createWorkspace() {
  await ws.request("workspace.create");
  // State sync will update UI
}

async function selectWorkspace(workspaceId) {
  activeWorkspaceId = workspaceId;
  await ws.request("workspace.select", { workspaceId });

  // Update UI immediately for responsiveness
  renderSidebar();
  for (const [id] of workspaces) {
    const viewEl = workspaceContainerEl.querySelector(`[data-workspace-id="${id}"]`);
    if (viewEl) {
      viewEl.classList.toggle("active", id === activeWorkspaceId);
    }
  }

  // Fit terminals in the newly visible workspace
  const renderer = renderers.get(workspaceId);
  if (renderer) {
    requestAnimationFrame(() => renderer.fitAll());
  }
}

async function closeWorkspace(workspaceId) {
  await ws.request("workspace.close", { workspaceId });
  // State sync will update UI
}

// --- Keyboard shortcuts ---

function handleKeyDown(e) {
  // Ctrl+Shift+N → new workspace
  if (e.ctrlKey && e.shiftKey && e.key === "N") {
    e.preventDefault();
    createWorkspace();
    return;
  }

  // Ctrl+Shift+D → split right
  if (e.ctrlKey && e.shiftKey && e.key === "D") {
    e.preventDefault();
    const renderer = renderers.get(activeWorkspaceId);
    if (renderer?.focusedSurfaceId) {
      ws.request("surface.split", { surfaceId: renderer.focusedSurfaceId, direction: "right" });
    }
    return;
  }

  // Ctrl+Shift+E → split down
  if (e.ctrlKey && e.shiftKey && e.key === "E") {
    e.preventDefault();
    const renderer = renderers.get(activeWorkspaceId);
    if (renderer?.focusedSurfaceId) {
      ws.request("surface.split", { surfaceId: renderer.focusedSurfaceId, direction: "down" });
    }
    return;
  }

  // Ctrl+Shift+W → close focused surface
  if (e.ctrlKey && e.shiftKey && e.key === "W") {
    e.preventDefault();
    const renderer = renderers.get(activeWorkspaceId);
    if (renderer?.focusedSurfaceId) {
      ws.request("surface.close", { surfaceId: renderer.focusedSurfaceId });
    }
    return;
  }

  // Ctrl+1-9 → switch workspace by index
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key >= "1" && e.key <= "9") {
    e.preventDefault();
    const index = parseInt(e.key) - 1;
    const ids = Array.from(workspaces.keys());
    if (ids[index]) {
      selectWorkspace(ids[index]);
    }
    return;
  }
}

// --- Boot ---

init().catch((err) => {
  console.error("[moravec] Failed to initialise:", err);
  document.body.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#f7768e;font-family:monospace;font-size:16px;">
      Failed to connect to moravec server. Is it running?
    </div>
  `;
});
