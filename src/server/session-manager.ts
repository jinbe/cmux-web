/**
 * Session manager — tracks workspaces, surfaces, and layout state.
 * This is the central state store for the moravec server.
 */

import { v4 as uuid } from "uuid";
import type {
  MoravecWorkspace,
  MoravecSurface,
  SplitLayout,
} from "../shared/protocol.js";

export class SessionManager {
  private workspaces = new Map<string, MoravecWorkspace>();
  private surfaces = new Map<string, MoravecSurface>();
  private activeWorkspaceId: string | null = null;

  /**
   * Create a new workspace with a single surface.
   */
  createWorkspace(name?: string): { workspace: MoravecWorkspace; surface: MoravecSurface } {
    const workspaceId = uuid();
    const surfaceId = uuid();
    const now = Date.now();

    const surface: MoravecSurface = {
      id: surfaceId,
      workspaceId,
      title: "shell",
      cwd: process.env.HOME ?? "/",
      cols: 120,
      rows: 30,
      createdAt: now,
    };

    const workspace: MoravecWorkspace = {
      id: workspaceId,
      name: name ?? `Workspace ${this.workspaces.size + 1}`,
      surfaces: [surface],
      layout: { type: "leaf", surfaceId },
      createdAt: now,
    };

    this.workspaces.set(workspaceId, workspace);
    this.surfaces.set(surfaceId, surface);

    if (!this.activeWorkspaceId) {
      this.activeWorkspaceId = workspaceId;
    }

    return { workspace, surface };
  }

  /**
   * Split a surface, creating a new surface alongside it.
   */
  splitSurface(
    surfaceId: string,
    direction: "right" | "down"
  ): { surface: MoravecSurface; workspace: MoravecWorkspace } | null {
    const existing = this.surfaces.get(surfaceId);
    if (!existing) return null;

    const workspace = this.workspaces.get(existing.workspaceId);
    if (!workspace) return null;

    const newSurfaceId = uuid();
    const newSurface: MoravecSurface = {
      id: newSurfaceId,
      workspaceId: workspace.id,
      title: "shell",
      cwd: existing.cwd,
      cols: direction === "right" ? Math.floor(existing.cols / 2) : existing.cols,
      rows: direction === "down" ? Math.floor(existing.rows / 2) : existing.rows,
      createdAt: Date.now(),
    };

    // Update the existing surface dimensions too
    if (direction === "right") {
      existing.cols = Math.floor(existing.cols / 2);
    } else {
      existing.rows = Math.floor(existing.rows / 2);
    }

    this.surfaces.set(newSurfaceId, newSurface);
    workspace.surfaces.push(newSurface);

    // Update layout tree
    const splitDirection = direction === "right" ? "horizontal" : "vertical";
    workspace.layout = this.insertSplit(workspace.layout, surfaceId, newSurfaceId, splitDirection);

    return { surface: newSurface, workspace };
  }

  /**
   * Close a surface and update layout.
   */
  closeSurface(surfaceId: string): { workspace: MoravecWorkspace; removed: boolean } | null {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return null;

    const workspace = this.workspaces.get(surface.workspaceId);
    if (!workspace) return null;

    // Don't close the last surface — close the workspace instead
    if (workspace.surfaces.length <= 1) {
      return this.closeWorkspace(workspace.id)
        ? { workspace, removed: true }
        : null;
    }

    this.surfaces.delete(surfaceId);
    workspace.surfaces = workspace.surfaces.filter((s) => s.id !== surfaceId);
    workspace.layout = this.removeSurface(workspace.layout, surfaceId);

    return { workspace, removed: false };
  }

  /**
   * Close an entire workspace.
   */
  closeWorkspace(workspaceId: string): MoravecWorkspace | null {
    const workspace = this.workspaces.get(workspaceId);
    if (!workspace) return null;

    for (const surface of workspace.surfaces) {
      this.surfaces.delete(surface.id);
    }
    this.workspaces.delete(workspaceId);

    if (this.activeWorkspaceId === workspaceId) {
      const remaining = Array.from(this.workspaces.keys());
      this.activeWorkspaceId = remaining.length > 0 ? remaining[0] : null;
    }

    return workspace;
  }

  /**
   * Update surface ratios in a split.
   * Finds the parent split containing the given surfaceId and sets its ratios.
   */
  setRatios(surfaceId: string, ratios: number[]): MoravecWorkspace | null {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return null;

    const workspace = this.workspaces.get(surface.workspaceId);
    if (!workspace) return null;

    this.updateRatios(workspace.layout, surfaceId, ratios);
    return workspace;
  }

  /**
   * Set the active workspace.
   */
  selectWorkspace(workspaceId: string): boolean {
    if (!this.workspaces.has(workspaceId)) return false;
    this.activeWorkspaceId = workspaceId;
    return true;
  }

  /**
   * Update a surface's title.
   */
  setSurfaceTitle(surfaceId: string, title: string): void {
    const surface = this.surfaces.get(surfaceId);
    if (surface) surface.title = title;
  }

  /**
   * Resize a surface (updates stored dimensions).
   */
  resizeSurface(surfaceId: string, cols: number, rows: number): boolean {
    const surface = this.surfaces.get(surfaceId);
    if (!surface) return false;
    surface.cols = cols;
    surface.rows = rows;
    return true;
  }

  // --- Getters ---

  getWorkspace(id: string): MoravecWorkspace | undefined {
    return this.workspaces.get(id);
  }

  getSurface(id: string): MoravecSurface | undefined {
    return this.surfaces.get(id);
  }

  getActiveWorkspaceId(): string | null {
    return this.activeWorkspaceId;
  }

  getAllWorkspaces(): MoravecWorkspace[] {
    return Array.from(this.workspaces.values());
  }

  getAllSurfaceIds(): string[] {
    return Array.from(this.surfaces.keys());
  }

  // --- Layout tree helpers ---

  private insertSplit(
    node: SplitLayout,
    targetSurfaceId: string,
    newSurfaceId: string,
    direction: "horizontal" | "vertical"
  ): SplitLayout {
    if (node.type === "leaf") {
      if (node.surfaceId === targetSurfaceId) {
        return {
          type: "split",
          direction,
          children: [
            { type: "leaf", surfaceId: targetSurfaceId },
            { type: "leaf", surfaceId: newSurfaceId },
          ],
          ratios: [0.5, 0.5],
        };
      }
      return node;
    }

    return {
      ...node,
      children: node.children.map((child) =>
        this.insertSplit(child, targetSurfaceId, newSurfaceId, direction)
      ),
    };
  }

  private removeSurface(node: SplitLayout, surfaceId: string): SplitLayout {
    if (node.type === "leaf") return node;

    const filtered = node.children.filter((child) => {
      if (child.type === "leaf") return child.surfaceId !== surfaceId;
      return true;
    });

    // Recursively clean child splits
    const cleaned = filtered.map((child) => this.removeSurface(child, surfaceId));

    // If only one child remains, promote it
    if (cleaned.length === 1) return cleaned[0];
    if (cleaned.length === 0) return { type: "leaf", surfaceId: "" }; // shouldn't happen

    // Redistribute ratios evenly
    const evenRatio = 1 / cleaned.length;
    return {
      ...node,
      children: cleaned,
      ratios: cleaned.map(() => evenRatio),
    };
  }

  private updateRatios(node: SplitLayout, surfaceId: string, ratios: number[]): boolean {
    if (node.type === "leaf") return false;

    // Check if this split contains the target surface as a direct child
    const hasTarget = node.children.some(
      (child) => child.type === "leaf" && child.surfaceId === surfaceId
    );

    if (hasTarget && ratios.length === node.children.length) {
      node.ratios = ratios;
      return true;
    }

    // Recurse into children
    for (const child of node.children) {
      if (this.updateRatios(child, surfaceId, ratios)) return true;
    }

    return false;
  }
}
