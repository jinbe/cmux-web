/**
 * E2E integration tests for the full cmux-web server stack.
 * Tests real WebSocket connections, Unix socket CLI, and PTY processes.
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import express from "express";
import { createServer } from "node:http";
import { SessionManager } from "../server/session-manager.js";
import { PtyManager } from "../server/pty-manager.js";
import { WsHandler } from "../server/ws-handler.js";
import { CliSocket } from "../server/cli-socket.js";
import WebSocket from "ws";
import * as net from "node:net";
import { randomUUID } from "node:crypto";
import type { ServerMessage, ClientMessage } from "../shared/protocol.js";

/**
 * Find a free port for the test server.
 */
function getRandomPort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
  });
}

/**
 * Send a WebSocket request and wait for the response.
 */
function wsRequest(ws: WebSocket, msg: ClientMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WS request timed out")), 5000);
    
    const handler = (raw: WebSocket.RawData) => {
      const data = JSON.parse(raw.toString());
      if (data.type === "response" && data.id === msg.id) {
        ws.off("message", handler);
        clearTimeout(timeout);
        resolve(data);
      }
    };
    
    ws.on("message", handler);
    ws.send(JSON.stringify(msg));
  });
}

/**
 * Collect broadcast messages (non-response messages).
 */
function collectMessages(
  ws: WebSocket, 
  count: number, 
  timeoutMs = 5000
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const messages: any[] = [];
    const timeout = setTimeout(() => resolve(messages), timeoutMs);
    
    const handler = (raw: WebSocket.RawData) => {
      const data = JSON.parse(raw.toString());
      // Only collect non-response messages (broadcasts)
      if (data.type !== "response") {
        messages.push(data);
        if (messages.length >= count) {
          ws.off("message", handler);
          clearTimeout(timeout);
          resolve(messages);
        }
      }
    };
    
    ws.on("message", handler);
  });
}

/**
 * Wait for a specific message type on a WebSocket.
 */
function waitForMessage(
  ws: WebSocket, 
  type: string, 
  timeoutMs = 5000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      ws.off("message", handler);
      reject(new Error(`Timed out waiting for ${type}`));
    }, timeoutMs);
    
    const handler = (raw: WebSocket.RawData) => {
      const data = JSON.parse(raw.toString());
      if (data.type === type) {
        ws.off("message", handler);
        clearTimeout(timeout);
        resolve(data);
      }
    };
    
    ws.on("message", handler);
  });
}

/**
 * Send a CLI request over Unix socket.
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

describe("Server E2E Integration", () => {
  let httpServer: ReturnType<typeof createServer>;
  let sessions: SessionManager;
  let ptys: PtyManager;
  let wsHandler: WsHandler;
  let cliSocket: CliSocket;
  let port: number;
  let socketPath: string;

  beforeAll(async () => {
    // Set up the server components
    port = await getRandomPort();
    socketPath = `/tmp/cmux-web-e2e-${randomUUID()}.sock`;

    const app = express();
    httpServer = createServer(app);

    sessions = new SessionManager();
    ptys = new PtyManager();
    wsHandler = new WsHandler(sessions, ptys, httpServer);
    cliSocket = new CliSocket(sessions, ptys, socketPath);

    // Start servers
    await new Promise<void>((resolve) => {
      httpServer.listen(port, () => resolve());
    });
    await cliSocket.start();
  });

  afterAll(async () => {
    // Clean up all resources
    ptys.killAll();
    cliSocket.stop();
    
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  describe("WebSocket Connection", () => {
    it("sends state.sync on connection", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);
      
      await new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          ws.on("message", (raw) => {
            const data = JSON.parse(raw.toString());
            expect(data.type).toBe("state.sync");
            expect(data.workspaces).toBeDefined();
            expect(data.activeWorkspaceId).toBeDefined();
            ws.close();
            resolve();
          });
        });
        
        ws.on("error", reject);
        
        setTimeout(() => reject(new Error("Connection timed out")), 5000);
      });
    });

    it("handles multiple concurrent connections", async () => {
      const ws1 = new WebSocket(`ws://localhost:${port}/ws`);
      const ws2 = new WebSocket(`ws://localhost:${port}/ws`);

      const promises = [ws1, ws2].map(ws => new Promise<void>((resolve, reject) => {
        ws.on("open", () => {
          ws.on("message", (raw) => {
            const data = JSON.parse(raw.toString());
            if (data.type === "state.sync") {
              resolve();
            }
          });
        });
        ws.on("error", reject);
        setTimeout(() => reject(new Error("Timeout")), 5000);
      }));

      await Promise.all(promises);

      ws1.close();
      ws2.close();
    });
  });

  describe("Workspace Operations via WebSocket", () => {
    it("creates a workspace and broadcasts update", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", async () => {
          try {
            // Wait for initial state.sync
            await waitForMessage(ws, "state.sync");

            // Start collecting broadcasts
            const broadcastPromise = collectMessages(ws, 2, 3000);

            // Create workspace
            const response = await wsRequest(ws, {
              type: "workspace.create",
              id: randomUUID(),
              params: { name: "E2E Test Workspace" },
            });

            expect(response.ok).toBe(true);
            expect(response.result.workspace_id).toBeDefined();
            expect(response.result.surface_id).toBeDefined();

            // Wait for broadcasts
            const broadcasts = await broadcastPromise;
            
            // Should receive workspace.updated and state.sync
            const types = broadcasts.map((msg: any) => msg.type);
            expect(types).toContain("workspace.updated");
            expect(types).toContain("state.sync");

            ws.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        ws.on("error", reject);
        setTimeout(() => reject(new Error("Test timed out")), 10000);
      });
    });

    it("selects a workspace", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", async () => {
          try {
            await waitForMessage(ws, "state.sync");

            // Create two workspaces
            const ws1Response = await wsRequest(ws, {
              type: "workspace.create",
              id: randomUUID(),
              params: { name: "WS1" },
            });

            const ws2Response = await wsRequest(ws, {
              type: "workspace.create",
              id: randomUUID(),
              params: { name: "WS2" },
            });

            // Select the first workspace
            const selectResponse = await wsRequest(ws, {
              type: "workspace.select",
              id: randomUUID(),
              params: { workspaceId: ws1Response.result.workspace_id },
            });

            expect(selectResponse.ok).toBe(true);

            // Verify active workspace changed
            expect(sessions.getActiveWorkspaceId()).toBe(ws1Response.result.workspace_id);

            ws.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        ws.on("error", reject);
        setTimeout(() => reject(new Error("Test timed out")), 10000);
      });
    });

    it("closes a workspace", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", async () => {
          try {
            await waitForMessage(ws, "state.sync");

            // Create workspace
            const createResponse = await wsRequest(ws, {
              type: "workspace.create",
              id: randomUUID(),
              params: { name: "To Close" },
            });

            const workspaceId = createResponse.result.workspace_id;

            // Close it
            const closeResponse = await wsRequest(ws, {
              type: "workspace.close",
              id: randomUUID(),
              params: { workspaceId },
            });

            expect(closeResponse.ok).toBe(true);
            expect(sessions.getWorkspace(workspaceId)).toBeUndefined();

            ws.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        ws.on("error", reject);
        setTimeout(() => reject(new Error("Test timed out")), 10000);
      });
    });
  });

  describe("Surface Operations via WebSocket", () => {
    it("splits a surface", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", async () => {
          try {
            await waitForMessage(ws, "state.sync");

            // Create workspace
            const createResponse = await wsRequest(ws, {
              type: "workspace.create",
              id: randomUUID(),
            });

            const surfaceId = createResponse.result.surface_id;

            // Split the surface
            const splitResponse = await wsRequest(ws, {
              type: "surface.split",
              id: randomUUID(),
              params: { surfaceId, direction: "right" },
            });

            expect(splitResponse.ok).toBe(true);
            expect(splitResponse.result.surface_id).toBeDefined();
            expect(splitResponse.result.workspace_id).toBeDefined();

            ws.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        ws.on("error", reject);
        setTimeout(() => reject(new Error("Test timed out")), 10000);
      });
    });

    it("closes a surface", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", async () => {
          try {
            await waitForMessage(ws, "state.sync");

            // Create workspace and split
            const createResponse = await wsRequest(ws, {
              type: "workspace.create",
              id: randomUUID(),
            });

            const surface1Id = createResponse.result.surface_id;

            const splitResponse = await wsRequest(ws, {
              type: "surface.split",
              id: randomUUID(),
              params: { surfaceId: surface1Id, direction: "right" },
            });

            const surface2Id = splitResponse.result.surface_id;

            // Close the second surface
            const closeResponse = await wsRequest(ws, {
              type: "surface.close",
              id: randomUUID(),
              params: { surfaceId: surface2Id },
            });

            expect(closeResponse.ok).toBe(true);

            ws.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        ws.on("error", reject);
        setTimeout(() => reject(new Error("Test timed out")), 10000);
      });
    });

    it("sends input and receives output from PTY", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", async () => {
          try {
            await waitForMessage(ws, "state.sync");

            // Create workspace
            const createResponse = await wsRequest(ws, {
              type: "workspace.create",
              id: randomUUID(),
            });

            const surfaceId = createResponse.result.surface_id;

            // Wait a moment for PTY to initialise
            await new Promise(r => setTimeout(r, 500));

            // Set up listener for surface.output
            const outputPromise = new Promise<string>((resolveOutput) => {
              const handler = (raw: WebSocket.RawData) => {
                const data = JSON.parse(raw.toString());
                if (data.type === "surface.output" && data.surfaceId === surfaceId) {
                  if (data.data.includes("CMUX_TEST_MARKER")) {
                    ws.off("message", handler);
                    resolveOutput(data.data);
                  }
                }
              };
              ws.on("message", handler);
            });

            // Send command to PTY
            ws.send(JSON.stringify({
              type: "surface.input",
              id: randomUUID(),
              params: { surfaceId, data: "echo CMUX_TEST_MARKER\n" },
            }));

            // Wait for output
            const output = await Promise.race([
              outputPromise,
              new Promise<string>((_, rej) => 
                setTimeout(() => rej(new Error("No output received")), 5000)
              ),
            ]);

            expect(output).toContain("CMUX_TEST_MARKER");

            ws.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        ws.on("error", reject);
        setTimeout(() => reject(new Error("Test timed out")), 15000);
      });
    });

    it("resizes a surface", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", async () => {
          try {
            await waitForMessage(ws, "state.sync");

            // Create workspace
            const createResponse = await wsRequest(ws, {
              type: "workspace.create",
              id: randomUUID(),
            });

            const surfaceId = createResponse.result.surface_id;

            // Resize the surface
            const resizeResponse = await wsRequest(ws, {
              type: "surface.resize",
              id: randomUUID(),
              params: { surfaceId, cols: 150, rows: 40 },
            });

            expect(resizeResponse.ok).toBe(true);

            // Verify the surface dimensions were updated
            const surface = sessions.getSurface(surfaceId);
            expect(surface?.cols).toBe(150);
            expect(surface?.rows).toBe(40);

            ws.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        ws.on("error", reject);
        setTimeout(() => reject(new Error("Test timed out")), 10000);
      });
    });
  });

  describe("CLI Socket Operations", () => {
    it("responds to system.ping", async () => {
      const response = await cliRequest(socketPath, "system.ping");

      expect(response.ok).toBe(true);
      expect(response.result.pong).toBe(true);
      expect(response.result.version).toBe("0.1.0");
    });

    it("creates workspace via CLI", async () => {
      const response = await cliRequest(socketPath, "workspace.create", {
        name: "CLI Workspace",
      });

      expect(response.ok).toBe(true);
      expect(response.result.workspace_id).toBeDefined();
      expect(response.result.surface_id).toBeDefined();

      // Verify it was created
      const workspace = sessions.getWorkspace(response.result.workspace_id);
      expect(workspace?.name).toBe("CLI Workspace");
    });

    it("lists workspaces via CLI", async () => {
      // Create some workspaces first
      await cliRequest(socketPath, "workspace.create", { name: "CLI WS 1" });
      await cliRequest(socketPath, "workspace.create", { name: "CLI WS 2" });

      const response = await cliRequest(socketPath, "workspace.list");

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.result.workspaces)).toBe(true);
      
      const names = response.result.workspaces.map((ws: any) => ws.name);
      expect(names).toContain("CLI WS 1");
      expect(names).toContain("CLI WS 2");
    });

    it("sends text to surface via CLI", async () => {
      // Create workspace
      const createResponse = await cliRequest(socketPath, "workspace.create");
      const surfaceId = createResponse.result.surface_id;

      // Send text
      const sendResponse = await cliRequest(socketPath, "surface.send_text", {
        surface_id: surfaceId,
        text: "echo test\n",
      });

      expect(sendResponse.ok).toBe(true);
    });
  });

  describe("CLI and WebSocket Integration", () => {
    it("CLI and WebSocket can operate independently on shared state", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", async () => {
          try {
            await waitForMessage(ws, "state.sync");

            // Create workspace via CLI
            const cliResponse = await cliRequest(socketPath, "workspace.create", {
              name: "CLI Created",
            });

            expect(cliResponse.ok).toBe(true);

            // Verify workspace exists in shared state (via WebSocket query)
            const listResponse = await wsRequest(ws, {
              type: "workspace.list",
              id: randomUUID(),
            });

            expect(listResponse.ok).toBe(true);
            const workspaceNames = listResponse.result.workspaces.map((w: any) => w.name);
            expect(workspaceNames).toContain("CLI Created");

            ws.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        ws.on("error", reject);
        setTimeout(() => reject(new Error("Test timed out")), 10000);
      });
    });

    it("multiple WebSocket clients receive same broadcasts", async () => {
      const ws1 = new WebSocket(`ws://localhost:${port}/ws`);
      const ws2 = new WebSocket(`ws://localhost:${port}/ws`);

      await new Promise<void>((resolve, reject) => {
        const collected1: any[] = [];
        const collected2: any[] = [];

        let synced = 0;
        const checkSynced = () => {
          synced++;
          if (synced === 2) {
            // Both have synced, now we can proceed
            setTimeout(run, 100); // Small delay to ensure listeners are ready
          }
        };

        // Set up message collectors immediately (before state.sync)
        ws1.on("message", (raw) => {
          const data = JSON.parse(raw.toString());
          if (data.type === "state.sync") {
            checkSynced();
          } else if (data.type !== "response") {
            collected1.push(data);
          }
        });

        ws2.on("message", (raw) => {
          const data = JSON.parse(raw.toString());
          if (data.type === "state.sync") {
            checkSynced();
          } else if (data.type !== "response") {
            collected2.push(data);
          }
        });

        const run = async () => {
          try {
            // Create workspace via first client
            const createRequest = {
              type: "workspace.create" as const,
              id: randomUUID(),
              params: { name: "Broadcast Test" },
            };

            // Send and wait for response
            const responsePromise = new Promise((resolveResponse) => {
              const handler = (raw: WebSocket.RawData) => {
                const data = JSON.parse(raw.toString());
                if (data.type === "response" && data.id === createRequest.id) {
                  ws1.off("message", handler);
                  resolveResponse(data);
                }
              };
              ws1.on("message", handler);
            });

            ws1.send(JSON.stringify(createRequest));
            await responsePromise;

            // Give time for broadcasts to arrive at both clients
            await new Promise(r => setTimeout(r, 500));

            // Both should have received workspace.updated broadcast
            expect(collected1.length).toBeGreaterThan(0);
            expect(collected2.length).toBeGreaterThan(0);

            const types1 = collected1.map((m: any) => m.type);
            const types2 = collected2.map((m: any) => m.type);

            expect(types1).toContain("workspace.updated");
            expect(types2).toContain("workspace.updated");

            ws1.close();
            ws2.close();
            resolve();
          } catch (err) {
            ws1.close();
            ws2.close();
            reject(err);
          }
        };

        ws1.on("error", reject);
        ws2.on("error", reject);

        setTimeout(() => {
          ws1.close();
          ws2.close();
          reject(new Error("Test timed out"));
        }, 10000);
      });
    });
  });

  describe("PTY Exit Handling", () => {
    it("broadcasts surface.exit when PTY exits", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", async () => {
          try {
            await waitForMessage(ws, "state.sync");

            // Create workspace
            const createResponse = await wsRequest(ws, {
              type: "workspace.create",
              id: randomUUID(),
            });

            const surfaceId = createResponse.result.surface_id;

            // Wait for PTY to be ready
            await new Promise(r => setTimeout(r, 500));

            // Listen for surface.exit
            const exitPromise = waitForMessage(ws, "surface.exit", 5000);

            // Send exit command
            ws.send(JSON.stringify({
              type: "surface.input",
              id: randomUUID(),
              params: { surfaceId, data: "exit\n" },
            }));

            // Wait for exit event
            const exitMsg = await exitPromise;

            expect(exitMsg.type).toBe("surface.exit");
            expect(exitMsg.surfaceId).toBe(surfaceId);
            expect(typeof exitMsg.exitCode).toBe("number");

            ws.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        ws.on("error", reject);
        setTimeout(() => reject(new Error("Test timed out")), 15000);
      });
    });
  });

  describe("Error Handling", () => {
    it("returns error for unknown workspace", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", async () => {
          try {
            await waitForMessage(ws, "state.sync");

            const response = await wsRequest(ws, {
              type: "workspace.close",
              id: randomUUID(),
              params: { workspaceId: "nonexistent" },
            });

            expect(response.ok).toBe(false);
            expect(response.error.code).toBe("not_found");

            ws.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        ws.on("error", reject);
        setTimeout(() => reject(new Error("Test timed out")), 10000);
      });
    });

    it("returns error for unknown surface", async () => {
      const ws = new WebSocket(`ws://localhost:${port}/ws`);

      await new Promise<void>((resolve, reject) => {
        ws.on("open", async () => {
          try {
            await waitForMessage(ws, "state.sync");

            const response = await wsRequest(ws, {
              type: "surface.split",
              id: randomUUID(),
              params: { surfaceId: "nonexistent", direction: "right" },
            });

            expect(response.ok).toBe(false);
            expect(response.error.code).toBe("not_found");

            ws.close();
            resolve();
          } catch (err) {
            reject(err);
          }
        });

        ws.on("error", reject);
        setTimeout(() => reject(new Error("Test timed out")), 10000);
      });
    });
  });
});
