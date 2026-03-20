/**
 * Moravec server entry point.
 *
 * Starts:
 * 1. HTTP server serving the web UI
 * 2. WebSocket server for real-time terminal I/O
 * 3. Unix domain socket for CLI control (cmux-compatible)
 */

import express from "express";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SessionManager } from "./session-manager.js";
import { PtyManager } from "./pty-manager.js";
import { WsHandler } from "./ws-handler.js";
import { CliSocket } from "./cli-socket.js";
import { DEFAULT_PORT, DEFAULT_SOCKET_PATH } from "../shared/protocol.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.MORAVEC_PORT ?? String(DEFAULT_PORT), 10);
const SOCKET_PATH = process.env.MORAVEC_SOCKET_PATH ?? DEFAULT_SOCKET_PATH;

async function main(): Promise<void> {
  const sessions = new SessionManager();
  const ptys = new PtyManager();

  // Create the initial workspace
  const { workspace, surface } = sessions.createWorkspace("Default");
  ptys.spawn(surface.id, { cols: surface.cols, rows: surface.rows });
  console.log(`[moravec] Created initial workspace "${workspace.name}" (${workspace.id})`);

  // HTTP server with static file serving
  const app = express();
  const publicDir = path.resolve(__dirname, "..", "public");
  app.use(express.static(publicDir));

  // SPA fallback
  app.get("*", (_req, res) => {
    res.sendFile(path.join(publicDir, "index.html"));
  });

  const httpServer = createServer(app);

  // WebSocket handler
  new WsHandler(sessions, ptys, httpServer);

  // CLI socket (cmux-compatible)
  const cliSocket = new CliSocket(sessions, ptys, SOCKET_PATH);
  await cliSocket.start();

  // Set env var so child processes can find the socket
  process.env.MORAVEC_SOCKET_PATH = cliSocket.path;

  // Start HTTP server
  httpServer.listen(PORT, () => {
    console.log(`[moravec] Web UI:  http://localhost:${PORT}`);
    console.log(`[moravec] Socket:  ${cliSocket.path}`);
  });

  // Graceful shutdown
  const shutdown = (): void => {
    console.log("\n[moravec] Shutting down...");
    ptys.killAll();
    cliSocket.stop();
    httpServer.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[moravec] Fatal:", err);
  process.exit(1);
});
