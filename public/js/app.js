/**
 * Moravec web client — main application entry point.
 * Orchestrates WebSocket connection, workspace management, and layout rendering.
 * Supports mobile with slide-over sidebar, toolbar, and single-pane mode.
 */

import { WsClient } from "./ws-client.js";
import { LayoutRenderer } from "./layout-renderer.js";

// --- Constants ---

const MOBILE_BREAKPOINT_PX = 768;
const SMALL_MOBILE_BREAKPOINT_PX = 480;
const SWIPE_THRESHOLD_PX = 50;

// --- State ---

/** @type {Map<string, object>} */
const workspaces = new Map();
let activeWorkspaceId = null;
/** @type {Map<string, LayoutRenderer>} */
const renderers = new Map();
let sidebarOpen = false;
let actionsMenuOpen = false;

// --- DOM refs ---
const workspaceTabsEl = document.getElementById("workspace-tabs");
const workspaceContainerEl = document.getElementById("workspace-container");
const addWorkspaceBtn = document.getElementById("add-workspace");
const sidebarEl = document.getElementById("sidebar");
const sidebarBackdrop = document.getElementById("sidebar-backdrop");
const sidebarCloseBtn = document.getElementById("sidebar-close");
const mobileToolbar = document.getElementById("mobile-toolbar");
const toolbarSidebarBtn = document.getElementById("toolbar-sidebar");
const toolbarWorkspaceName = document.getElementById("toolbar-workspace-name");
const toolbarSurfaceSwitcher = document.getElementById("toolbar-surface-switcher");
const toolbarActionsBtn = document.getElementById("toolbar-actions");
const actionsMenu = document.getElementById("actions-menu");

// --- WebSocket client ---
const ws = new WsClient();

// --- Helpers ---

function isMobile() {
  return window.innerWidth <= MOBILE_BREAKPOINT_PX;
}

function isSmallMobile() {
  return window.innerWidth <= SMALL_MOBILE_BREAKPOINT_PX;
}

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
  addWorkspaceBtn.addEventListener("click", () => {
    createWorkspace();
    closeSidebar();
  });

  // Keyboard shortcuts
  document.addEventListener("keydown", handleKeyDown);

  // Window resize → refit terminals + update mobile state
  window.addEventListener("resize", handleWindowResize);

  // Mobile: sidebar toggle
  toolbarSidebarBtn.addEventListener("click", toggleSidebar);
  sidebarBackdrop.addEventListener("click", closeSidebar);
  sidebarCloseBtn.addEventListener("click", closeSidebar);

  // Mobile: actions menu
  toolbarActionsBtn.addEventListener("click", toggleActionsMenu);
  document.addEventListener("click", (e) => {
    if (actionsMenuOpen && !actionsMenu.contains(e.target) && e.target !== toolbarActionsBtn) {
      closeActionsMenu();
    }
  });

  // Wire action menu items
  for (const item of actionsMenu.querySelectorAll(".action-item")) {
    item.addEventListener("click", () => handleActionMenuItem(item.dataset.action));
  }

  // Mobile: swipe gestures
  setupSwipeGestures();

  // Set initial mobile state
  updateMobileState();
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
  updateMobileToolbar();
}

function handleWorkspaceUpdated(msg) {
  const ws = msg.workspace;
  workspaces.set(ws.id, ws);
  renderSidebar();
  renderWorkspace(ws.id);
  updateMobileToolbar();
}

function handleSurfaceOutput(msg) {
  for (const renderer of renderers.values()) {
    renderer.write(msg.surfaceId, msg.data);
  }
}

function handleSurfaceExit(_msg) {
  // The server will send a workspace update or state sync
}

function handleSurfaceTitle(_msg) {
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
    tab.addEventListener("click", () => {
      selectWorkspace(id);
      closeSidebar();
    });
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

  workspaceContainerEl.innerHTML = "";

  for (const [id] of workspaces) {
    renderWorkspace(id);
  }
}

function renderWorkspace(workspaceId) {
  const wsData = workspaces.get(workspaceId);
  if (!wsData) return;

  let viewEl = workspaceContainerEl.querySelector(`[data-workspace-id="${workspaceId}"]`);
  if (!viewEl) {
    viewEl = document.createElement("div");
    viewEl.className = "workspace-view";
    viewEl.dataset.workspaceId = workspaceId;
    workspaceContainerEl.appendChild(viewEl);
  }

  viewEl.classList.toggle("active", workspaceId === activeWorkspaceId);

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
        updateMobileToolbar();
        if (isSmallMobile()) {
          updateSinglePaneVisibility(workspaceId, surfaceId);
        }
      },
      onRatiosChanged: (surfaceId, ratios) => {
        ws.send("surface.set_ratios", { surfaceId, ratios });
      },
    });
    renderers.set(workspaceId, renderer);
  }

  renderer.render(viewEl, wsData.layout, wsData.surfaces);

  // On small mobile, ensure single-pane mode is applied
  if (isSmallMobile() && workspaceId === activeWorkspaceId) {
    const focusedId = renderer.focusedSurfaceId;
    if (focusedId) {
      updateSinglePaneVisibility(workspaceId, focusedId);
    }
  }
}

// --- Actions ---

async function createWorkspace() {
  await ws.request("workspace.create");
}

async function selectWorkspace(workspaceId) {
  activeWorkspaceId = workspaceId;
  await ws.request("workspace.select", { workspaceId });

  renderSidebar();
  for (const [id] of workspaces) {
    const viewEl = workspaceContainerEl.querySelector(`[data-workspace-id="${id}"]`);
    if (viewEl) {
      viewEl.classList.toggle("active", id === activeWorkspaceId);
    }
  }

  const renderer = renderers.get(workspaceId);
  if (renderer) {
    requestAnimationFrame(() => renderer.fitAll());
  }

  updateMobileToolbar();
}

async function closeWorkspace(workspaceId) {
  await ws.request("workspace.close", { workspaceId });
}

// --- Mobile: Sidebar ---

function toggleSidebar() {
  sidebarOpen ? closeSidebar() : openSidebar();
}

function openSidebar() {
  sidebarOpen = true;
  sidebarEl.classList.add("open");
  sidebarBackdrop.classList.add("visible");
}

function closeSidebar() {
  sidebarOpen = false;
  sidebarEl.classList.remove("open");
  sidebarBackdrop.classList.remove("visible");
}

// --- Mobile: Actions menu ---

function toggleActionsMenu() {
  actionsMenuOpen ? closeActionsMenu() : openActionsMenu();
}

function openActionsMenu() {
  actionsMenuOpen = true;
  actionsMenu.classList.remove("hidden");
}

function closeActionsMenu() {
  actionsMenuOpen = false;
  actionsMenu.classList.add("hidden");
}

function handleActionMenuItem(action) {
  closeActionsMenu();
  const renderer = renderers.get(activeWorkspaceId);
  const focusedSurfaceId = renderer?.focusedSurfaceId;

  switch (action) {
    case "split-right":
      if (focusedSurfaceId) ws.request("surface.split", { surfaceId: focusedSurfaceId, direction: "right" });
      break;
    case "split-down":
      if (focusedSurfaceId) ws.request("surface.split", { surfaceId: focusedSurfaceId, direction: "down" });
      break;
    case "new-workspace":
      createWorkspace();
      break;
    case "close-surface":
      if (focusedSurfaceId) ws.request("surface.close", { surfaceId: focusedSurfaceId });
      break;
  }
}

// --- Mobile: Toolbar ---

function updateMobileToolbar() {
  if (!isMobile()) return;

  const wsData = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : null;
  toolbarWorkspaceName.textContent = wsData?.name ?? "—";

  // Render surface pips (dots for each pane)
  toolbarSurfaceSwitcher.innerHTML = "";
  if (wsData) {
    const renderer = renderers.get(activeWorkspaceId);
    const focusedId = renderer?.focusedSurfaceId;

    for (const surface of wsData.surfaces) {
      const pip = document.createElement("div");
      pip.className = `surface-pip${surface.id === focusedId ? " active" : ""}`;
      pip.title = surface.title;
      pip.addEventListener("click", () => {
        renderer?.focus(surface.id);
        if (isSmallMobile()) {
          updateSinglePaneVisibility(activeWorkspaceId, surface.id);
        }
        updateMobileToolbar();
      });
      toolbarSurfaceSwitcher.appendChild(pip);
    }
  }
}

// --- Mobile: Single-pane mode ---

function updateSinglePaneVisibility(workspaceId, focusedSurfaceId) {
  const viewEl = workspaceContainerEl.querySelector(`[data-workspace-id="${workspaceId}"]`);
  if (!viewEl) return;

  // Clear all mobile-visible classes
  for (const el of viewEl.querySelectorAll(".mobile-visible")) {
    el.classList.remove("mobile-visible");
  }

  // Find the surface wrapper and mark it + all ancestors visible
  const surfaceWrapper = viewEl.querySelector(`[data-surface-id="${focusedSurfaceId}"]`);
  if (surfaceWrapper) {
    surfaceWrapper.classList.add("mobile-visible");
    let parent = surfaceWrapper.parentElement;
    while (parent && parent !== viewEl) {
      if (parent.classList.contains("split-container")) {
        parent.classList.add("mobile-visible");
      }
      parent = parent.parentElement;
    }
  }
}

function updateMobileState() {
  if (isSmallMobile()) {
    document.body.classList.add("mobile-single-pane");
  } else {
    document.body.classList.remove("mobile-single-pane");
  }
}

// --- Mobile: Swipe gestures ---

function setupSwipeGestures() {
  let touchStartX = 0;
  let touchStartY = 0;
  let touchStartTime = 0;

  document.addEventListener("touchstart", (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchStartTime = Date.now();
  }, { passive: true });

  document.addEventListener("touchend", (e) => {
    const deltaX = e.changedTouches[0].clientX - touchStartX;
    const deltaY = e.changedTouches[0].clientY - touchStartY;
    const elapsed = Date.now() - touchStartTime;

    // Only count quick swipes (< 300ms) that are more horizontal than vertical
    if (elapsed > 300 || Math.abs(deltaY) > Math.abs(deltaX)) return;

    if (!isMobile()) return;

    // Swipe right from left edge → open sidebar
    if (deltaX > SWIPE_THRESHOLD_PX && touchStartX < 30) {
      openSidebar();
      return;
    }

    // Swipe left while sidebar is open → close it
    if (deltaX < -SWIPE_THRESHOLD_PX && sidebarOpen) {
      closeSidebar();
      return;
    }

    // On small mobile: swipe left/right to switch between surfaces
    if (isSmallMobile() && Math.abs(deltaX) > SWIPE_THRESHOLD_PX && !sidebarOpen) {
      const wsData = activeWorkspaceId ? workspaces.get(activeWorkspaceId) : null;
      const renderer = renderers.get(activeWorkspaceId);
      if (!wsData || !renderer) return;

      const surfaces = wsData.surfaces;
      const currentIndex = surfaces.findIndex((s) => s.id === renderer.focusedSurfaceId);
      if (currentIndex === -1) return;

      let nextIndex;
      if (deltaX < -SWIPE_THRESHOLD_PX) {
        // Swipe left → next surface
        nextIndex = Math.min(currentIndex + 1, surfaces.length - 1);
      } else {
        // Swipe right → previous surface
        nextIndex = Math.max(currentIndex - 1, 0);
      }

      if (nextIndex !== currentIndex) {
        renderer.focus(surfaces[nextIndex].id);
        updateSinglePaneVisibility(activeWorkspaceId, surfaces[nextIndex].id);
        updateMobileToolbar();
      }
    }
  }, { passive: true });
}

// --- Window resize handler ---

function handleWindowResize() {
  updateMobileState();
  updateMobileToolbar();

  for (const renderer of renderers.values()) {
    renderer.fitAll();
  }

  // If resizing out of mobile, ensure sidebar is in correct state
  if (!isMobile()) {
    sidebarEl.classList.remove("open");
    sidebarBackdrop.classList.remove("visible");
    sidebarOpen = false;
    closeActionsMenu();
  }
}

// --- Keyboard shortcuts ---

function handleKeyDown(e) {
  // Escape → close sidebar or actions menu
  if (e.key === "Escape") {
    if (actionsMenuOpen) {
      closeActionsMenu();
      e.preventDefault();
      return;
    }
    if (sidebarOpen) {
      closeSidebar();
      e.preventDefault();
      return;
    }
  }

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
    <div style="display:flex;align-items:center;justify-content:center;height:100%;color:#f7768e;font-family:monospace;font-size:16px;padding:20px;text-align:center;">
      Failed to connect to moravec server.<br/>Is it running?
    </div>
  `;
});
