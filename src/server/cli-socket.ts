/**
 * Unix domain socket server for CLI control.
 * Speaks the same newline-delimited JSON protocol as cmux v2,
 * so existing cmux tooling can talk to moravec.
 */

import * as net from "node:net";
import * as fs from "node:fs";
import type { CliRequest, CliResponse } from "../shared/protocol.js";
import type { SessionManager } from "./session-manager.js";
import type { PtyManager } from "./pty-manager.js";
import { DEFAULT_SOCKET_PATH } from "../shared/protocol.js";

export class CliSocket {
  private server: net.Server | null = null;
  private socketPath: string;

  constructor(
    private sessions: SessionManager,
    private ptys: PtyManager,
    socketPath?: string
  ) {
    this.socketPath = socketPath ?? DEFAULT_SOCKET_PATH;
  }

  /**
   * Start listening on the Unix domain socket.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Clean up stale socket file
      try {
        fs.unlinkSync(this.socketPath);
      } catch {
        // Doesn't exist, fine
      }

      this.server = net.createServer((conn) => this.handleConnection(conn));

      this.server.on("error", (err) => {
        console.error(`[moravec] CLI socket error: ${err.message}`);
        reject(err);
      });

      this.server.listen(this.socketPath, () => {
        console.log(`[moravec] CLI socket listening at ${this.socketPath}`);
        resolve();
      });
    });
  }

  /**
   * Stop the socket server.
   */
  stop(): void {
    this.server?.close();
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // Already gone
    }
  }

  get path(): string {
    return this.socketPath;
  }

  private handleConnection(conn: net.Socket): void {
    let buffer = "";

    conn.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleLine(conn, line.trim());
      }
    });

    conn.on("error", () => {
      // Client disconnected, fine
    });
  }

  private handleLine(conn: net.Socket, line: string): void {
    let request: CliRequest;
    try {
      request = JSON.parse(line);
    } catch {
      // Not JSON — ignore
      return;
    }

    const response = this.dispatch(request);
    conn.write(JSON.stringify(response) + "\n");
  }

  private dispatch(req: CliRequest): CliResponse {
    try {
      switch (req.method) {
        case "workspace.list": {
          const workspaces = this.sessions.getAllWorkspaces();
          return { id: req.id, ok: true, result: { workspaces } };
        }

        case "workspace.create": {
          const { workspace, surface } = this.sessions.createWorkspace(req.params?.name);
          this.ptys.spawn(surface.id, { cols: surface.cols, rows: surface.rows });
          return {
            id: req.id,
            ok: true,
            result: { workspace_id: workspace.id, surface_id: surface.id },
          };
        }

        case "workspace.current": {
          const activeId = this.sessions.getActiveWorkspaceId();
          if (!activeId) {
            return { id: req.id, ok: false, error: { code: "not_found", message: "no active workspace" } };
          }
          const workspace = this.sessions.getWorkspace(activeId);
          return { id: req.id, ok: true, result: { workspace } };
        }

        case "workspace.select": {
          const ok = this.sessions.selectWorkspace(req.params.workspace_id ?? req.params.workspaceId);
          if (!ok) {
            return { id: req.id, ok: false, error: { code: "not_found", message: "workspace not found" } };
          }
          return { id: req.id, ok: true, result: {} };
        }

        case "workspace.close": {
          const wsId = req.params.workspace_id ?? req.params.workspaceId;
          const workspace = this.sessions.getWorkspace(wsId);
          if (!workspace) {
            return { id: req.id, ok: false, error: { code: "not_found", message: "workspace not found" } };
          }
          // Kill all PTYs in the workspace
          for (const surface of workspace.surfaces) {
            this.ptys.kill(surface.id);
          }
          this.sessions.closeWorkspace(wsId);
          return { id: req.id, ok: true, result: {} };
        }

        case "surface.list": {
          const workspaces = this.sessions.getAllWorkspaces();
          const surfaces = workspaces.flatMap((ws) =>
            ws.surfaces.map((s) => ({
              ...s,
              workspace_name: ws.name,
            }))
          );
          return { id: req.id, ok: true, result: { surfaces } };
        }

        case "surface.split": {
          const surfaceId = req.params.surface_id ?? req.params.surfaceId;
          const direction = req.params.direction === "down" ? "down" : "right";
          const result = this.sessions.splitSurface(surfaceId, direction);
          if (!result) {
            return { id: req.id, ok: false, error: { code: "not_found", message: "surface not found" } };
          }
          this.ptys.spawn(result.surface.id, {
            cols: result.surface.cols,
            rows: result.surface.rows,
          });
          return {
            id: req.id,
            ok: true,
            result: {
              surface_id: result.surface.id,
              workspace_id: result.workspace.id,
            },
          };
        }

        case "surface.close": {
          const surfaceId = req.params.surface_id ?? req.params.surfaceId;
          this.ptys.kill(surfaceId);
          const result = this.sessions.closeSurface(surfaceId);
          if (!result) {
            return { id: req.id, ok: false, error: { code: "not_found", message: "surface not found" } };
          }
          return { id: req.id, ok: true, result: {} };
        }

        case "surface.focus": {
          // In a web context, focus is client-side. We just acknowledge.
          return { id: req.id, ok: true, result: {} };
        }

        case "surface.send_text": {
          const surfaceId = req.params.surface_id ?? req.params.surfaceId;
          const ok = this.ptys.write(surfaceId, req.params.text);
          if (!ok) {
            return { id: req.id, ok: false, error: { code: "not_found", message: "surface not found" } };
          }
          return { id: req.id, ok: true, result: {} };
        }

        case "system.ping": {
          return { id: req.id, ok: true, result: { pong: true, version: "0.1.0" } };
        }

        default:
          return {
            id: req.id,
            ok: false,
            error: { code: "unknown_method", message: `Unknown method: ${req.method}` },
          };
      }
    } catch (err: any) {
      return {
        id: req.id,
        ok: false,
        error: { code: "internal", message: err.message ?? "unknown error" },
      };
    }
  }
}
