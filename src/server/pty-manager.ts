/**
 * PTY manager — spawns and manages pseudo-terminal processes.
 * Each surface gets its own PTY instance.
 */

import * as pty from "node-pty";
import { EventEmitter } from "node:events";

const DEFAULT_SHELL = process.env.SHELL || "/bin/bash";
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;

export interface PtyInstance {
  id: string;
  process: pty.IPty;
  cols: number;
  rows: number;
}

export class PtyManager extends EventEmitter {
  private instances = new Map<string, PtyInstance>();

  /**
   * Spawn a new PTY for the given surface ID.
   */
  spawn(surfaceId: string, options?: { cols?: number; rows?: number; cwd?: string }): PtyInstance {
    const cols = options?.cols ?? DEFAULT_COLS;
    const rows = options?.rows ?? DEFAULT_ROWS;
    const cwd = options?.cwd ?? process.env.HOME ?? "/";

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      CMUX_WEB_SURFACE_ID: surfaceId,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    };

    const proc = pty.spawn(DEFAULT_SHELL, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env,
    });

    const instance: PtyInstance = { id: surfaceId, process: proc, cols, rows };
    this.instances.set(surfaceId, instance);

    proc.onData((data: string) => {
      this.emit("data", surfaceId, data);
    });

    proc.onExit(({ exitCode }: { exitCode: number }) => {
      this.instances.delete(surfaceId);
      this.emit("exit", surfaceId, exitCode);
    });

    return instance;
  }

  /**
   * Write data to a surface's PTY.
   */
  write(surfaceId: string, data: string): boolean {
    const instance = this.instances.get(surfaceId);
    if (!instance) return false;
    instance.process.write(data);
    return true;
  }

  /**
   * Resize a surface's PTY.
   */
  resize(surfaceId: string, cols: number, rows: number): boolean {
    const instance = this.instances.get(surfaceId);
    if (!instance) return false;
    instance.process.resize(cols, rows);
    instance.cols = cols;
    instance.rows = rows;
    return true;
  }

  /**
   * Kill a surface's PTY.
   */
  kill(surfaceId: string): boolean {
    const instance = this.instances.get(surfaceId);
    if (!instance) return false;
    instance.process.kill();
    this.instances.delete(surfaceId);
    return true;
  }

  /**
   * Get a PTY instance by surface ID.
   */
  get(surfaceId: string): PtyInstance | undefined {
    return this.instances.get(surfaceId);
  }

  /**
   * Kill all PTY instances (for shutdown).
   */
  killAll(): void {
    for (const [id, instance] of this.instances) {
      instance.process.kill();
      this.instances.delete(id);
    }
  }

  /**
   * Number of active PTY instances.
   */
  get size(): number {
    return this.instances.size;
  }
}
