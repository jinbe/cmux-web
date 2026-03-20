/**
 * WebSocket handler — bridges browser clients to PTY sessions.
 * Handles multiplexed terminal I/O and workspace management commands.
 */

import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import type { Server as HttpServer } from "node:http";
import type { ClientMessage, ServerMessage } from "../shared/protocol.js";
import type { SessionManager } from "./session-manager.js";
import type { PtyManager } from "./pty-manager.js";
import { HEARTBEAT_INTERVAL_MS } from "../shared/protocol.js";

export class WsHandler {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(
    private sessions: SessionManager,
    private ptys: PtyManager,
    httpServer: HttpServer
  ) {
    this.wss = new WebSocketServer({ server: httpServer, path: "/ws" });

    this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));

    // Wire PTY output to all connected clients
    this.ptys.on("data", (surfaceId: string, data: string) => {
      this.broadcast({ type: "surface.output", surfaceId, data });
    });

    this.ptys.on("exit", (surfaceId: string, exitCode: number) => {
      this.broadcast({ type: "surface.exit", surfaceId, exitCode });
    });

    // Heartbeat to keep connections alive
    setInterval(() => {
      for (const client of this.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.ping();
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private handleConnection(ws: WebSocket, _req: IncomingMessage): void {
    this.clients.add(ws);
    console.log(`[moravec] WebSocket client connected (${this.clients.size} total)`);

    // Send initial state sync
    const syncMessage: ServerMessage = {
      type: "state.sync",
      workspaces: this.sessions.getAllWorkspaces(),
      activeWorkspaceId: this.sessions.getActiveWorkspaceId(),
    };
    ws.send(JSON.stringify(syncMessage));

    ws.on("message", (raw) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());
        this.handleMessage(ws, msg);
      } catch (err: any) {
        console.error("[moravec] Invalid message:", err.message);
      }
    });

    ws.on("close", () => {
      this.clients.delete(ws);
      console.log(`[moravec] WebSocket client disconnected (${this.clients.size} total)`);
    });

    ws.on("error", (err) => {
      console.error("[moravec] WebSocket error:", err.message);
      this.clients.delete(ws);
    });
  }

  private handleMessage(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.type) {
      case "workspace.list": {
        this.reply(ws, msg.id, { workspaces: this.sessions.getAllWorkspaces() });
        break;
      }

      case "workspace.create": {
        const { workspace, surface } = this.sessions.createWorkspace(msg.params?.name);
        this.ptys.spawn(surface.id, { cols: surface.cols, rows: surface.rows });
        this.reply(ws, msg.id, { workspace_id: workspace.id, surface_id: surface.id });
        this.broadcastWorkspaceUpdate(workspace.id);
        this.broadcastStateSync();
        break;
      }

      case "workspace.close": {
        const workspace = this.sessions.getWorkspace(msg.params.workspaceId);
        if (!workspace) {
          this.replyError(ws, msg.id, "not_found", "workspace not found");
          return;
        }
        for (const surface of workspace.surfaces) {
          this.ptys.kill(surface.id);
        }
        this.sessions.closeWorkspace(msg.params.workspaceId);
        this.reply(ws, msg.id, {});
        this.broadcastStateSync();
        break;
      }

      case "workspace.select": {
        const ok = this.sessions.selectWorkspace(msg.params.workspaceId);
        if (!ok) {
          this.replyError(ws, msg.id, "not_found", "workspace not found");
          return;
        }
        this.reply(ws, msg.id, {});
        this.broadcastStateSync();
        break;
      }

      case "surface.create": {
        const workspace = this.sessions.getWorkspace(msg.params.workspaceId);
        if (!workspace) {
          this.replyError(ws, msg.id, "not_found", "workspace not found");
          return;
        }
        // This creates a workspace-level surface, but typically you'd use split instead
        this.reply(ws, msg.id, {});
        break;
      }

      case "surface.split": {
        const result = this.sessions.splitSurface(msg.params.surfaceId, msg.params.direction);
        if (!result) {
          this.replyError(ws, msg.id, "not_found", "surface not found");
          return;
        }
        this.ptys.spawn(result.surface.id, {
          cols: result.surface.cols,
          rows: result.surface.rows,
        });
        this.reply(ws, msg.id, {
          surface_id: result.surface.id,
          workspace_id: result.workspace.id,
        });
        this.broadcastWorkspaceUpdate(result.workspace.id);
        break;
      }

      case "surface.close": {
        this.ptys.kill(msg.params.surfaceId);
        const result = this.sessions.closeSurface(msg.params.surfaceId);
        if (!result) {
          this.replyError(ws, msg.id, "not_found", "surface not found");
          return;
        }
        this.reply(ws, msg.id, {});
        if (result.removed) {
          this.broadcastStateSync();
        } else {
          this.broadcastWorkspaceUpdate(result.workspace.id);
        }
        break;
      }

      case "surface.resize": {
        this.sessions.resizeSurface(msg.params.surfaceId, msg.params.cols, msg.params.rows);
        this.ptys.resize(msg.params.surfaceId, msg.params.cols, msg.params.rows);
        this.reply(ws, msg.id, {});
        break;
      }

      case "surface.focus": {
        // Acknowledged — focus is client-side
        this.reply(ws, msg.id, {});
        break;
      }

      case "surface.input": {
        const ok = this.ptys.write(msg.params.surfaceId, msg.params.data);
        if (!ok) {
          this.replyError(ws, msg.id, "not_found", "surface not found");
          return;
        }
        // No reply needed for input — it's fire-and-forget for perf
        break;
      }

      case "surface.set_ratios": {
        const workspace = this.sessions.setRatios(msg.params.surfaceId, msg.params.ratios);
        if (!workspace) {
          this.replyError(ws, msg.id, "not_found", "surface not found");
          return;
        }
        this.reply(ws, msg.id, {});
        this.broadcastWorkspaceUpdate(workspace.id);
        break;
      }

      default:
        this.replyError(ws, (msg as any).id, "unknown_type", `Unknown message type: ${(msg as any).type}`);
    }
  }

  private reply(ws: WebSocket, id: string, result: any): void {
    const msg: ServerMessage = { type: "response", id, ok: true, result };
    ws.send(JSON.stringify(msg));
  }

  private replyError(ws: WebSocket, id: string, code: string, message: string): void {
    const msg: ServerMessage = { type: "response", id, ok: false, error: { code, message } };
    ws.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  private broadcastWorkspaceUpdate(workspaceId: string): void {
    const workspace = this.sessions.getWorkspace(workspaceId);
    if (workspace) {
      this.broadcast({ type: "workspace.updated", workspace });
    }
  }

  private broadcastStateSync(): void {
    this.broadcast({
      type: "state.sync",
      workspaces: this.sessions.getAllWorkspaces(),
      activeWorkspaceId: this.sessions.getActiveWorkspaceId(),
    });
  }
}
