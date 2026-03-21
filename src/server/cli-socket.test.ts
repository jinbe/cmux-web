/**
 * Unit tests for CliSocket — Unix domain socket CLI interface.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CliSocket } from "./cli-socket.js";
import { SessionManager } from "./session-manager.js";
import { EventEmitter } from "node:events";
import * as net from "node:net";
import { randomUUID } from "node:crypto";

/**
 * Mock PtyManager for testing CliSocket without spawning real PTYs.
 */
class MockPtyManager extends EventEmitter {
  spawned: Array<{ surfaceId: string; options: any }> = [];
  killed: string[] = [];
  written: Array<{ surfaceId: string; data: string }> = [];
  private shouldWriteFail = false;
  private shouldKillFail = false;

  spawn(surfaceId: string, options?: any) {
    this.spawned.push({ surfaceId, options });
    return { 
      id: surfaceId, 
      process: {} as any, 
      cols: options?.cols ?? 120, 
      rows: options?.rows ?? 30 
    };
  }

  write(surfaceId: string, data: string): boolean {
    if (this.shouldWriteFail) return false;
    this.written.push({ surfaceId, data });
    return true;
  }

  resize(_surfaceId: string, _cols: number, _rows: number): boolean { 
    return true; 
  }

  kill(surfaceId: string): boolean {
    if (this.shouldKillFail) return false;
    this.killed.push(surfaceId);
    return true;
  }

  get(_surfaceId: string) { 
    return undefined; 
  }

  killAll() {}

  get size() { 
    return 0; 
  }

  setWriteFail(fail: boolean) {
    this.shouldWriteFail = fail;
  }

  setKillFail(fail: boolean) {
    this.shouldKillFail = fail;
  }
}

/**
 * Helper to send a CLI request and receive response.
 */
function cliRequest(
  socketPath: string, 
  method: string, 
  params: Record<string, any> = {}
): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const conn = net.createConnection(socketPath, () => {
      conn.write(JSON.stringify({ id, method, params }) + "\n");
    });

    let buffer = "";
    const timer = setTimeout(() => { 
      conn.destroy(); 
      reject(new Error("CLI request timed out")); 
    }, 5000);

    conn.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      
      for (const line of lines) {
        if (!line.trim()) continue;
        const response = JSON.parse(line);
        if (response.id === id) {
          clearTimeout(timer);
          conn.destroy();
          resolve(response);
        }
      }
    });

    conn.on("error", (err) => { 
      clearTimeout(timer); 
      reject(err); 
    });
  });
}

describe("CliSocket", () => {
  let sessions: SessionManager;
  let ptys: MockPtyManager;
  let cliSocket: CliSocket;
  let socketPath: string;

  beforeEach(async () => {
    sessions = new SessionManager();
    ptys = new MockPtyManager();
    socketPath = `/tmp/cmux-web-test-${randomUUID()}.sock`;
    cliSocket = new CliSocket(sessions, ptys as any, socketPath);
    await cliSocket.start();
  });

  afterEach(() => {
    cliSocket.stop();
  });

  describe("system.ping", () => {
    it("responds with pong and version", async () => {
      const response = await cliRequest(socketPath, "system.ping");

      expect(response.ok).toBe(true);
      expect(response.result.pong).toBe(true);
      expect(response.result.version).toBe("0.1.0");
    });
  });

  describe("workspace.list", () => {
    it("returns empty list when no workspaces exist", async () => {
      const response = await cliRequest(socketPath, "workspace.list");

      expect(response.ok).toBe(true);
      expect(response.result.workspaces).toEqual([]);
    });

    it("returns all workspaces", async () => {
      sessions.createWorkspace("First");
      sessions.createWorkspace("Second");

      const response = await cliRequest(socketPath, "workspace.list");

      expect(response.ok).toBe(true);
      expect(response.result.workspaces).toHaveLength(2);
      expect(response.result.workspaces[0].name).toBe("First");
      expect(response.result.workspaces[1].name).toBe("Second");
    });
  });

  describe("workspace.create", () => {
    it("creates a workspace with default name", async () => {
      const response = await cliRequest(socketPath, "workspace.create");

      expect(response.ok).toBe(true);
      expect(response.result.workspace_id).toBeDefined();
      expect(response.result.surface_id).toBeDefined();

      // Verify PTY was spawned
      expect(ptys.spawned).toHaveLength(1);
      expect(ptys.spawned[0].surfaceId).toBe(response.result.surface_id);
    });

    it("creates a workspace with custom name", async () => {
      const response = await cliRequest(socketPath, "workspace.create", { 
        name: "CustomWS" 
      });

      expect(response.ok).toBe(true);
      const workspaces = sessions.getAllWorkspaces();
      expect(workspaces[0].name).toBe("CustomWS");
    });

    it("spawns PTY with correct dimensions", async () => {
      const response = await cliRequest(socketPath, "workspace.create");

      expect(ptys.spawned[0].options.cols).toBe(120);
      expect(ptys.spawned[0].options.rows).toBe(30);
    });
  });

  describe("workspace.current", () => {
    it("returns the active workspace", async () => {
      const { workspace } = sessions.createWorkspace("Active");

      const response = await cliRequest(socketPath, "workspace.current");

      expect(response.ok).toBe(true);
      expect(response.result.workspace.id).toBe(workspace.id);
      expect(response.result.workspace.name).toBe("Active");
    });

    it("returns not_found when no active workspace", async () => {
      const response = await cliRequest(socketPath, "workspace.current");

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("not_found");
      expect(response.error.message).toBe("no active workspace");
    });
  });

  describe("workspace.select", () => {
    it("switches active workspace", async () => {
      const { workspace: ws1 } = sessions.createWorkspace("First");
      const { workspace: ws2 } = sessions.createWorkspace("Second");

      const response = await cliRequest(socketPath, "workspace.select", { 
        workspace_id: ws1.id 
      });

      expect(response.ok).toBe(true);
      expect(sessions.getActiveWorkspaceId()).toBe(ws1.id);
    });

    it("accepts workspaceId param (camelCase)", async () => {
      const { workspace } = sessions.createWorkspace("Test");

      const response = await cliRequest(socketPath, "workspace.select", { 
        workspaceId: workspace.id 
      });

      expect(response.ok).toBe(true);
    });

    it("returns not_found for unknown workspace", async () => {
      const response = await cliRequest(socketPath, "workspace.select", { 
        workspace_id: "nonexistent" 
      });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("not_found");
    });
  });

  describe("workspace.close", () => {
    it("closes a workspace and kills all surfaces", async () => {
      const { workspace, surface } = sessions.createWorkspace("ToClose");
      
      const response = await cliRequest(socketPath, "workspace.close", { 
        workspace_id: workspace.id 
      });

      expect(response.ok).toBe(true);
      expect(sessions.getWorkspace(workspace.id)).toBeUndefined();
      expect(ptys.killed).toContain(surface.id);
    });

    it("accepts workspaceId param (camelCase)", async () => {
      const { workspace } = sessions.createWorkspace("Test");

      const response = await cliRequest(socketPath, "workspace.close", { 
        workspaceId: workspace.id 
      });

      expect(response.ok).toBe(true);
    });

    it("returns not_found for unknown workspace", async () => {
      const response = await cliRequest(socketPath, "workspace.close", { 
        workspace_id: "nonexistent" 
      });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("not_found");
    });

    it("kills all surfaces in a multi-surface workspace", async () => {
      const { workspace, surface: s1 } = sessions.createWorkspace("Multi");
      const split = sessions.splitSurface(s1.id, "right");

      const response = await cliRequest(socketPath, "workspace.close", { 
        workspace_id: workspace.id 
      });

      expect(response.ok).toBe(true);
      expect(ptys.killed).toContain(s1.id);
      expect(ptys.killed).toContain(split!.surface.id);
    });
  });

  describe("surface.list", () => {
    it("returns empty list when no surfaces exist", async () => {
      const response = await cliRequest(socketPath, "surface.list");

      expect(response.ok).toBe(true);
      expect(response.result.surfaces).toEqual([]);
    });

    it("returns all surfaces with workspace names", async () => {
      const { workspace: ws1, surface: s1 } = sessions.createWorkspace("WS1");
      const { workspace: ws2, surface: s2 } = sessions.createWorkspace("WS2");

      const response = await cliRequest(socketPath, "surface.list");

      expect(response.ok).toBe(true);
      expect(response.result.surfaces).toHaveLength(2);
      
      const surfaceIds = response.result.surfaces.map((s: any) => s.id);
      expect(surfaceIds).toContain(s1.id);
      expect(surfaceIds).toContain(s2.id);

      const ws1Surface = response.result.surfaces.find((s: any) => s.id === s1.id);
      expect(ws1Surface.workspace_name).toBe("WS1");
    });

    it("includes surfaces from split workspaces", async () => {
      const { surface: s1 } = sessions.createWorkspace("Split");
      sessions.splitSurface(s1.id, "right");

      const response = await cliRequest(socketPath, "surface.list");

      expect(response.ok).toBe(true);
      expect(response.result.surfaces).toHaveLength(2);
    });
  });

  describe("surface.split", () => {
    it("splits a surface horizontally (right)", async () => {
      const { surface } = sessions.createWorkspace("Test");

      const response = await cliRequest(socketPath, "surface.split", { 
        surface_id: surface.id, 
        direction: "right" 
      });

      expect(response.ok).toBe(true);
      expect(response.result.surface_id).toBeDefined();
      expect(response.result.workspace_id).toBeDefined();
      expect(ptys.spawned).toHaveLength(1);
    });

    it("splits a surface vertically (down)", async () => {
      const { surface } = sessions.createWorkspace("Test");

      const response = await cliRequest(socketPath, "surface.split", { 
        surface_id: surface.id, 
        direction: "down" 
      });

      expect(response.ok).toBe(true);
      expect(response.result.surface_id).toBeDefined();
    });

    it("accepts surfaceId param (camelCase)", async () => {
      const { surface } = sessions.createWorkspace("Test");

      const response = await cliRequest(socketPath, "surface.split", { 
        surfaceId: surface.id, 
        direction: "right" 
      });

      expect(response.ok).toBe(true);
    });

    it("defaults to right direction for invalid direction", async () => {
      const { surface } = sessions.createWorkspace("Test");

      const response = await cliRequest(socketPath, "surface.split", { 
        surface_id: surface.id, 
        direction: "invalid" 
      });

      expect(response.ok).toBe(true);
    });

    it("returns not_found for unknown surface", async () => {
      const response = await cliRequest(socketPath, "surface.split", { 
        surface_id: "nonexistent", 
        direction: "right" 
      });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("not_found");
    });
  });

  describe("surface.close", () => {
    it("closes a surface", async () => {
      const { surface: s1 } = sessions.createWorkspace("Test");
      const split = sessions.splitSurface(s1.id, "right");

      const response = await cliRequest(socketPath, "surface.close", { 
        surface_id: split!.surface.id 
      });

      expect(response.ok).toBe(true);
      expect(ptys.killed).toContain(split!.surface.id);
    });

    it("accepts surfaceId param (camelCase)", async () => {
      const { surface: s1 } = sessions.createWorkspace("Test");
      const split = sessions.splitSurface(s1.id, "right");

      const response = await cliRequest(socketPath, "surface.close", { 
        surfaceId: split!.surface.id 
      });

      expect(response.ok).toBe(true);
    });

    it("returns not_found for unknown surface", async () => {
      const response = await cliRequest(socketPath, "surface.close", { 
        surface_id: "nonexistent" 
      });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("not_found");
    });
  });

  describe("surface.focus", () => {
    it("always returns success (no-op)", async () => {
      const response = await cliRequest(socketPath, "surface.focus", { 
        surface_id: "any-id" 
      });

      expect(response.ok).toBe(true);
      expect(response.result).toEqual({});
    });
  });

  describe("surface.send_text", () => {
    it("writes text to a surface PTY", async () => {
      const { surface } = sessions.createWorkspace("Test");

      const response = await cliRequest(socketPath, "surface.send_text", { 
        surface_id: surface.id, 
        text: "echo hello\n" 
      });

      expect(response.ok).toBe(true);
      expect(ptys.written).toHaveLength(1);
      expect(ptys.written[0].surfaceId).toBe(surface.id);
      expect(ptys.written[0].data).toBe("echo hello\n");
    });

    it("accepts surfaceId param (camelCase)", async () => {
      const { surface } = sessions.createWorkspace("Test");

      const response = await cliRequest(socketPath, "surface.send_text", { 
        surfaceId: surface.id, 
        text: "test" 
      });

      expect(response.ok).toBe(true);
    });

    it("returns not_found when PTY write fails", async () => {
      const { surface } = sessions.createWorkspace("Test");
      ptys.setWriteFail(true);

      const response = await cliRequest(socketPath, "surface.send_text", { 
        surface_id: surface.id, 
        text: "test" 
      });

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("not_found");
    });
  });

  describe("error handling", () => {
    it("handles invalid JSON gracefully", async () => {
      return new Promise<void>((resolve, reject) => {
        const conn = net.createConnection(socketPath, () => {
          conn.write("{ invalid json\n");
          
          // Should not crash, should just ignore invalid line
          setTimeout(() => {
            conn.destroy();
            resolve();
          }, 100);
        });

        conn.on("error", reject);
      });
    });

    it("returns error for unknown method", async () => {
      const response = await cliRequest(socketPath, "unknown.method");

      expect(response.ok).toBe(false);
      expect(response.error.code).toBe("unknown_method");
      expect(response.error.message).toContain("unknown.method");
    });

    it("handles multiple requests on same connection", async () => {
      return new Promise<void>((resolve, reject) => {
        const id1 = randomUUID();
        const id2 = randomUUID();
        const responses: any[] = [];

        const conn = net.createConnection(socketPath, () => {
          conn.write(JSON.stringify({ id: id1, method: "system.ping", params: {} }) + "\n");
          conn.write(JSON.stringify({ id: id2, method: "system.ping", params: {} }) + "\n");
        });

        let buffer = "";
        const timer = setTimeout(() => {
          conn.destroy();
          reject(new Error("Test timed out"));
        }, 5000);

        conn.on("data", (data) => {
          buffer += data.toString();
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;
            responses.push(JSON.parse(line));

            if (responses.length === 2) {
              clearTimeout(timer);
              conn.destroy();

              expect(responses[0].id).toBe(id1);
              expect(responses[1].id).toBe(id2);
              expect(responses[0].ok).toBe(true);
              expect(responses[1].ok).toBe(true);
              resolve();
            }
          }
        });

        conn.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
    });
  });
});
