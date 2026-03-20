/**
 * Tests for SessionManager — workspace and layout state management.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SessionManager } from "./session-manager.js";

describe("SessionManager", () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  describe("createWorkspace", () => {
    it("creates a workspace with one surface", () => {
      const { workspace, surface } = manager.createWorkspace("Test");

      expect(workspace.name).toBe("Test");
      expect(workspace.surfaces).toHaveLength(1);
      expect(workspace.surfaces[0].id).toBe(surface.id);
      expect(workspace.layout).toEqual({ type: "leaf", surfaceId: surface.id });
    });

    it("sets the first workspace as active", () => {
      const { workspace } = manager.createWorkspace();
      expect(manager.getActiveWorkspaceId()).toBe(workspace.id);
    });

    it("auto-names workspaces sequentially", () => {
      const { workspace: ws1 } = manager.createWorkspace();
      const { workspace: ws2 } = manager.createWorkspace();

      expect(ws1.name).toBe("Workspace 1");
      expect(ws2.name).toBe("Workspace 2");
    });
  });

  describe("splitSurface", () => {
    it("splits a surface horizontally (right)", () => {
      const { surface } = manager.createWorkspace();
      const result = manager.splitSurface(surface.id, "right");

      expect(result).not.toBeNull();
      expect(result!.workspace.surfaces).toHaveLength(2);
      expect(result!.workspace.layout).toEqual({
        type: "split",
        direction: "horizontal",
        children: [
          { type: "leaf", surfaceId: surface.id },
          { type: "leaf", surfaceId: result!.surface.id },
        ],
        ratios: [0.5, 0.5],
      });
    });

    it("splits a surface vertically (down)", () => {
      const { surface } = manager.createWorkspace();
      const result = manager.splitSurface(surface.id, "down");

      expect(result).not.toBeNull();
      expect(result!.workspace.layout).toEqual({
        type: "split",
        direction: "vertical",
        children: [
          { type: "leaf", surfaceId: surface.id },
          { type: "leaf", surfaceId: result!.surface.id },
        ],
        ratios: [0.5, 0.5],
      });
    });

    it("handles nested splits", () => {
      const { surface: s1 } = manager.createWorkspace();
      const r1 = manager.splitSurface(s1.id, "right");
      const r2 = manager.splitSurface(r1!.surface.id, "down");

      const ws = r2!.workspace;
      expect(ws.surfaces).toHaveLength(3);

      // Layout should be: horizontal split → [s1, vertical split → [r1.surface, r2.surface]]
      expect(ws.layout.type).toBe("split");
      if (ws.layout.type === "split") {
        expect(ws.layout.direction).toBe("horizontal");
        expect(ws.layout.children[0]).toEqual({ type: "leaf", surfaceId: s1.id });
        expect(ws.layout.children[1].type).toBe("split");
        if (ws.layout.children[1].type === "split") {
          expect(ws.layout.children[1].direction).toBe("vertical");
        }
      }
    });

    it("returns null for unknown surface", () => {
      manager.createWorkspace();
      const result = manager.splitSurface("nonexistent", "right");
      expect(result).toBeNull();
    });
  });

  describe("closeSurface", () => {
    it("removes a surface from a multi-surface workspace", () => {
      const { surface: s1 } = manager.createWorkspace();
      const r1 = manager.splitSurface(s1.id, "right");

      const result = manager.closeSurface(r1!.surface.id);

      expect(result).not.toBeNull();
      expect(result!.removed).toBe(false);
      expect(result!.workspace.surfaces).toHaveLength(1);
      expect(result!.workspace.layout).toEqual({ type: "leaf", surfaceId: s1.id });
    });

    it("closes the workspace when closing the last surface", () => {
      const { workspace, surface } = manager.createWorkspace();
      const result = manager.closeSurface(surface.id);

      expect(result).not.toBeNull();
      expect(result!.removed).toBe(true);
      expect(manager.getWorkspace(workspace.id)).toBeUndefined();
    });

    it("returns null for unknown surface", () => {
      manager.createWorkspace();
      const result = manager.closeSurface("nonexistent");
      expect(result).toBeNull();
    });
  });

  describe("closeWorkspace", () => {
    it("removes all surfaces in the workspace", () => {
      const { workspace, surface: s1 } = manager.createWorkspace();
      manager.splitSurface(s1.id, "right");

      const removed = manager.closeWorkspace(workspace.id);

      expect(removed).not.toBeNull();
      expect(manager.getWorkspace(workspace.id)).toBeUndefined();
      expect(manager.getSurface(s1.id)).toBeUndefined();
    });

    it("switches active workspace when closing the active one", () => {
      const { workspace: ws1 } = manager.createWorkspace("First");
      const { workspace: ws2 } = manager.createWorkspace("Second");

      manager.selectWorkspace(ws1.id);
      manager.closeWorkspace(ws1.id);

      expect(manager.getActiveWorkspaceId()).toBe(ws2.id);
    });
  });

  describe("selectWorkspace", () => {
    it("switches the active workspace", () => {
      const { workspace: ws1 } = manager.createWorkspace();
      const { workspace: ws2 } = manager.createWorkspace();

      manager.selectWorkspace(ws2.id);
      expect(manager.getActiveWorkspaceId()).toBe(ws2.id);

      manager.selectWorkspace(ws1.id);
      expect(manager.getActiveWorkspaceId()).toBe(ws1.id);
    });

    it("returns false for unknown workspace", () => {
      manager.createWorkspace();
      expect(manager.selectWorkspace("nonexistent")).toBe(false);
    });
  });

  describe("setRatios", () => {
    it("updates ratios for a split containing the surface", () => {
      const { surface: s1 } = manager.createWorkspace();
      const r1 = manager.splitSurface(s1.id, "right");

      const ws = manager.setRatios(s1.id, [0.7, 0.3]);

      expect(ws).not.toBeNull();
      if (ws!.layout.type === "split") {
        expect(ws!.layout.ratios).toEqual([0.7, 0.3]);
      }
    });
  });

  describe("resizeSurface", () => {
    it("updates stored dimensions", () => {
      const { surface } = manager.createWorkspace();
      manager.resizeSurface(surface.id, 200, 50);

      const s = manager.getSurface(surface.id);
      expect(s?.cols).toBe(200);
      expect(s?.rows).toBe(50);
    });
  });

  describe("getAllWorkspaces", () => {
    it("returns all workspaces", () => {
      manager.createWorkspace("A");
      manager.createWorkspace("B");
      manager.createWorkspace("C");

      const all = manager.getAllWorkspaces();
      expect(all).toHaveLength(3);
      expect(all.map((ws) => ws.name)).toEqual(["A", "B", "C"]);
    });
  });
});
