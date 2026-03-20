/**
 * CLI socket client — connects to the moravec Unix domain socket.
 * cmux-compatible: sends newline-delimited JSON requests.
 */

import * as net from "node:net";
import * as crypto from "node:crypto";
import { DEFAULT_SOCKET_PATH } from "../shared/protocol.js";

export interface CliClientOptions {
  socketPath?: string;
  timeout?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

/**
 * Send a single request to the moravec socket and return the response.
 * Opens a new connection per request (simple, stateless CLI use).
 */
export async function request(
  method: string,
  params: Record<string, any> = {},
  options?: CliClientOptions
): Promise<any> {
  const socketPath = options?.socketPath ?? process.env.MORAVEC_SOCKET_PATH ?? DEFAULT_SOCKET_PATH;
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const payload = JSON.stringify({ id, method, params });

    const conn = net.createConnection(socketPath, () => {
      conn.write(payload + "\n");
    });

    let buffer = "";

    const timer = setTimeout(() => {
      conn.destroy();
      reject(new Error(`Request timed out after ${timeout}ms`));
    }, timeout);

    conn.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          if (response.id === id) {
            clearTimeout(timer);
            conn.destroy();
            if (response.ok) {
              resolve(response.result);
            } else {
              reject(new Error(response.error?.message ?? "Unknown error"));
            }
            return;
          }
        } catch {
          // Not JSON, skip
        }
      }
    });

    conn.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Cannot connect to moravec at ${socketPath}: ${err.message}`));
    });

    conn.on("close", () => {
      clearTimeout(timer);
    });
  });
}
