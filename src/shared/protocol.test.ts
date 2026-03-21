/**
 * Unit tests for shared protocol constants and types.
 */

import { describe, it, expect } from "vitest";
import {
  DEFAULT_PORT,
  DEFAULT_SOCKET_PATH,
  HEARTBEAT_INTERVAL_MS,
  type ClientMessage,
  type ServerMessage,
  type CliRequest,
  type CliResponse,
  type CmuxWebWorkspace,
  type CmuxWebSurface,
  type SplitLayout,
} from "./protocol.js";

describe("Protocol Constants", () => {
  describe("DEFAULT_PORT", () => {
    it("has expected value", () => {
      expect(DEFAULT_PORT).toBe(7681);
      expect(typeof DEFAULT_PORT).toBe("number");
    });
  });

  describe("DEFAULT_SOCKET_PATH", () => {
    it("has expected value", () => {
      expect(DEFAULT_SOCKET_PATH).toBe("/tmp/cmux-web.sock");
      expect(typeof DEFAULT_SOCKET_PATH).toBe("string");
    });
  });

  describe("HEARTBEAT_INTERVAL_MS", () => {
    it("has expected value", () => {
      expect(HEARTBEAT_INTERVAL_MS).toBe(30_000);
      expect(typeof HEARTBEAT_INTERVAL_MS).toBe("number");
    });

    it("is 30 seconds", () => {
      expect(HEARTBEAT_INTERVAL_MS).toBe(30 * 1000);
    });
  });
});

describe("Protocol Types", () => {
  describe("CmuxWebWorkspace", () => {
    it("has correct shape", () => {
      const workspace: CmuxWebWorkspace = {
        id: "ws-1",
        name: "Test Workspace",
        surfaces: [],
        layout: { type: "leaf", surfaceId: "surf-1" },
        createdAt: Date.now(),
      };

      expect(workspace.id).toBe("ws-1");
      expect(workspace.name).toBe("Test Workspace");
      expect(Array.isArray(workspace.surfaces)).toBe(true);
      expect(workspace.layout.type).toBe("leaf");
      expect(typeof workspace.createdAt).toBe("number");
    });
  });

  describe("CmuxWebSurface", () => {
    it("has correct shape", () => {
      const surface: CmuxWebSurface = {
        id: "surf-1",
        workspaceId: "ws-1",
        title: "Terminal",
        cwd: "/home/user",
        cols: 120,
        rows: 30,
        createdAt: Date.now(),
      };

      expect(surface.id).toBe("surf-1");
      expect(surface.workspaceId).toBe("ws-1");
      expect(surface.title).toBe("Terminal");
      expect(surface.cwd).toBe("/home/user");
      expect(surface.cols).toBe(120);
      expect(surface.rows).toBe(30);
      expect(typeof surface.createdAt).toBe("number");
    });
  });

  describe("SplitLayout", () => {
    it("supports leaf layout", () => {
      const layout: SplitLayout = {
        type: "leaf",
        surfaceId: "surf-1",
      };

      expect(layout.type).toBe("leaf");
      if (layout.type === "leaf") {
        expect(layout.surfaceId).toBe("surf-1");
      }
    });

    it("supports split layout with horizontal direction", () => {
      const layout: SplitLayout = {
        type: "split",
        direction: "horizontal",
        children: [
          { type: "leaf", surfaceId: "surf-1" },
          { type: "leaf", surfaceId: "surf-2" },
        ],
        ratios: [0.5, 0.5],
      };

      expect(layout.type).toBe("split");
      if (layout.type === "split") {
        expect(layout.direction).toBe("horizontal");
        expect(layout.children).toHaveLength(2);
        expect(layout.ratios).toEqual([0.5, 0.5]);
      }
    });

    it("supports split layout with vertical direction", () => {
      const layout: SplitLayout = {
        type: "split",
        direction: "vertical",
        children: [
          { type: "leaf", surfaceId: "surf-1" },
          { type: "leaf", surfaceId: "surf-2" },
        ],
        ratios: [0.3, 0.7],
      };

      expect(layout.type).toBe("split");
      if (layout.type === "split") {
        expect(layout.direction).toBe("vertical");
        expect(layout.ratios).toEqual([0.3, 0.7]);
      }
    });

    it("supports nested split layouts", () => {
      const layout: SplitLayout = {
        type: "split",
        direction: "horizontal",
        children: [
          { type: "leaf", surfaceId: "surf-1" },
          {
            type: "split",
            direction: "vertical",
            children: [
              { type: "leaf", surfaceId: "surf-2" },
              { type: "leaf", surfaceId: "surf-3" },
            ],
            ratios: [0.5, 0.5],
          },
        ],
        ratios: [0.5, 0.5],
      };

      expect(layout.type).toBe("split");
      if (layout.type === "split") {
        expect(layout.children[1].type).toBe("split");
      }
    });
  });

  describe("ClientMessage", () => {
    it("supports workspace.list message", () => {
      const msg: ClientMessage = {
        type: "workspace.list",
        id: "req-1",
      };

      expect(msg.type).toBe("workspace.list");
      expect(msg.id).toBe("req-1");
    });

    it("supports workspace.create message", () => {
      const msg: ClientMessage = {
        type: "workspace.create",
        id: "req-2",
        params: { name: "My Workspace" },
      };

      expect(msg.type).toBe("workspace.create");
      expect(msg.params?.name).toBe("My Workspace");
    });

    it("supports surface.input message", () => {
      const msg: ClientMessage = {
        type: "surface.input",
        id: "req-3",
        params: { surfaceId: "surf-1", data: "echo test\n" },
      };

      expect(msg.type).toBe("surface.input");
      expect(msg.params.surfaceId).toBe("surf-1");
      expect(msg.params.data).toBe("echo test\n");
    });
  });

  describe("ServerMessage", () => {
    it("supports response message (success)", () => {
      const msg: ServerMessage = {
        type: "response",
        id: "req-1",
        ok: true,
        result: { workspaces: [] },
      };

      expect(msg.type).toBe("response");
      expect(msg.id).toBe("req-1");
      expect(msg.ok).toBe(true);
      expect(msg.result).toEqual({ workspaces: [] });
    });

    it("supports response message (error)", () => {
      const msg: ServerMessage = {
        type: "response",
        id: "req-2",
        ok: false,
        error: { code: "not_found", message: "Workspace not found" },
      };

      expect(msg.type).toBe("response");
      expect(msg.ok).toBe(false);
      if (!msg.ok) {
        expect(msg.error.code).toBe("not_found");
        expect(msg.error.message).toBe("Workspace not found");
      }
    });

    it("supports surface.output message", () => {
      const msg: ServerMessage = {
        type: "surface.output",
        surfaceId: "surf-1",
        data: "Hello, world!\n",
      };

      expect(msg.type).toBe("surface.output");
      expect(msg.surfaceId).toBe("surf-1");
      expect(msg.data).toBe("Hello, world!\n");
    });

    it("supports surface.exit message", () => {
      const msg: ServerMessage = {
        type: "surface.exit",
        surfaceId: "surf-1",
        exitCode: 0,
      };

      expect(msg.type).toBe("surface.exit");
      expect(msg.surfaceId).toBe("surf-1");
      expect(msg.exitCode).toBe(0);
    });

    it("supports state.sync message", () => {
      const msg: ServerMessage = {
        type: "state.sync",
        workspaces: [],
        activeWorkspaceId: "ws-1",
      };

      expect(msg.type).toBe("state.sync");
      expect(msg.workspaces).toEqual([]);
      expect(msg.activeWorkspaceId).toBe("ws-1");
    });

    it("supports workspace.updated message", () => {
      const workspace: CmuxWebWorkspace = {
        id: "ws-1",
        name: "Test",
        surfaces: [],
        layout: { type: "leaf", surfaceId: "surf-1" },
        createdAt: Date.now(),
      };

      const msg: ServerMessage = {
        type: "workspace.updated",
        workspace,
      };

      expect(msg.type).toBe("workspace.updated");
      expect(msg.workspace.id).toBe("ws-1");
    });
  });

  describe("CliRequest", () => {
    it("has correct shape", () => {
      const request: CliRequest = {
        id: "cli-1",
        method: "workspace.list",
        params: {},
      };

      expect(request.id).toBe("cli-1");
      expect(request.method).toBe("workspace.list");
      expect(request.params).toEqual({});
    });

    it("supports params", () => {
      const request: CliRequest = {
        id: "cli-2",
        method: "workspace.create",
        params: { name: "My Workspace" },
      };

      expect(request.params.name).toBe("My Workspace");
    });
  });

  describe("CliResponse", () => {
    it("supports success response", () => {
      const response: CliResponse = {
        id: "cli-1",
        ok: true,
        result: { workspaces: [] },
      };

      expect(response.id).toBe("cli-1");
      expect(response.ok).toBe(true);
      expect(response.result).toEqual({ workspaces: [] });
    });

    it("supports error response", () => {
      const response: CliResponse = {
        id: "cli-2",
        ok: false,
        error: { code: "not_found", message: "Not found" },
      };

      expect(response.id).toBe("cli-2");
      expect(response.ok).toBe(false);
      expect(response.error?.code).toBe("not_found");
      expect(response.error?.message).toBe("Not found");
    });
  });
});
