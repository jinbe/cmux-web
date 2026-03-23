/**
 * Unit tests for PtyManager — PTY process lifecycle and event handling.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { PtyManager } from "./pty-manager.js";

describe("PtyManager", () => {
  let manager: PtyManager;

  beforeEach(() => {
    manager = new PtyManager();
  });

  afterEach(() => {
    // Clean up all PTY processes after each test
    manager.killAll();
  });

  describe("spawn", () => {
    it("creates a PTY instance and increments size", () => {
      expect(manager.size).toBe(0);

      const instance = manager.spawn("surface-1");

      expect(instance.id).toBe("surface-1");
      expect(instance.process).toBeDefined();
      expect(instance.cols).toBe(120); // DEFAULT_COLS
      expect(instance.rows).toBe(30); // DEFAULT_ROWS
      expect(manager.size).toBe(1);
    });

    it("creates a PTY with custom dimensions", () => {
      const instance = manager.spawn("surface-2", { cols: 200, rows: 50 });

      expect(instance.cols).toBe(200);
      expect(instance.rows).toBe(50);
    });

    it("creates a PTY with custom cwd", () => {
      const instance = manager.spawn("surface-3", { cwd: "/tmp" });

      expect(instance.id).toBe("surface-3");
      expect(instance.process).toBeDefined();
    });

    it("emits data events when PTY outputs data", async () => {
      const dataEvents: Array<{ surfaceId: string; data: string }> = [];
      
      manager.on("data", (surfaceId: string, data: string) => {
        dataEvents.push({ surfaceId, data });
      });

      const instance = manager.spawn("surface-data-test");

      // Wait for shell startup output (shells typically emit prompt/banner)
      const deadline = Date.now() + 3000;
      while (dataEvents.length === 0 && Date.now() < deadline) {
        await Bun.sleep(50);
      }
      expect(dataEvents.length).toBeGreaterThan(0);
      expect(dataEvents[0].surfaceId).toBe("surface-data-test");
    });

    it("emits exit events when PTY is killed", async () => {
      const exitEvents: Array<{ surfaceId: string; exitCode: number }> = [];

      manager.on("exit", (surfaceId: string, exitCode: number) => {
        exitEvents.push({ surfaceId, exitCode });
      });

      const instance = manager.spawn("surface-exit-test");
      
      // Kill the PTY
      instance.process.kill();

      // Wait for the exit event
      const deadline = Date.now() + 2000;
      while (exitEvents.length === 0 && Date.now() < deadline) {
        await Bun.sleep(50);
      }
      expect(exitEvents.length).toBe(1);
      expect(exitEvents[0].surfaceId).toBe("surface-exit-test");
    });

    it("creates multiple independent PTY instances", () => {
      manager.spawn("surface-a");
      manager.spawn("surface-b");
      manager.spawn("surface-c");

      expect(manager.size).toBe(3);
      expect(manager.get("surface-a")).toBeDefined();
      expect(manager.get("surface-b")).toBeDefined();
      expect(manager.get("surface-c")).toBeDefined();
    });
  });

  describe("write", () => {
    it("writes data to an existing PTY", () => {
      manager.spawn("surface-write");

      const result = manager.write("surface-write", "echo test\n");

      expect(result).toBe(true);
    });

    it("returns false for unknown surface", () => {
      const result = manager.write("nonexistent", "some data");

      expect(result).toBe(false);
    });

    it("can write to multiple PTYs independently", () => {
      manager.spawn("surface-1");
      manager.spawn("surface-2");

      expect(manager.write("surface-1", "data-1")).toBe(true);
      expect(manager.write("surface-2", "data-2")).toBe(true);
    });
  });

  describe("resize", () => {
    it("resizes an existing PTY", () => {
      const instance = manager.spawn("surface-resize");

      const result = manager.resize("surface-resize", 150, 40);

      expect(result).toBe(true);
      const updated = manager.get("surface-resize");
      expect(updated?.cols).toBe(150);
      expect(updated?.rows).toBe(40);
    });

    it("returns false for unknown surface", () => {
      const result = manager.resize("nonexistent", 100, 50);

      expect(result).toBe(false);
    });
  });

  describe("kill", () => {
    it("removes a PTY instance and returns true", () => {
      manager.spawn("surface-kill");
      expect(manager.size).toBe(1);

      const result = manager.kill("surface-kill");

      expect(result).toBe(true);
      expect(manager.size).toBe(0);
      expect(manager.get("surface-kill")).toBeUndefined();
    });

    it("returns false for unknown surface", () => {
      const result = manager.kill("nonexistent");

      expect(result).toBe(false);
    });

    it("kills only the specified PTY", () => {
      manager.spawn("surface-1");
      manager.spawn("surface-2");
      manager.spawn("surface-3");

      manager.kill("surface-2");

      expect(manager.size).toBe(2);
      expect(manager.get("surface-1")).toBeDefined();
      expect(manager.get("surface-2")).toBeUndefined();
      expect(manager.get("surface-3")).toBeDefined();
    });
  });

  describe("killAll", () => {
    it("clears all PTY instances", () => {
      manager.spawn("surface-1");
      manager.spawn("surface-2");
      manager.spawn("surface-3");
      expect(manager.size).toBe(3);

      manager.killAll();

      expect(manager.size).toBe(0);
      expect(manager.get("surface-1")).toBeUndefined();
      expect(manager.get("surface-2")).toBeUndefined();
      expect(manager.get("surface-3")).toBeUndefined();
    });

    it("does nothing if no instances exist", () => {
      expect(manager.size).toBe(0);

      manager.killAll(); // Should not throw

      expect(manager.size).toBe(0);
    });
  });

  describe("get", () => {
    it("returns a PTY instance by surface ID", () => {
      const spawned = manager.spawn("surface-get");

      const instance = manager.get("surface-get");

      expect(instance).toBeDefined();
      expect(instance?.id).toBe("surface-get");
      expect(instance?.id).toBe(spawned.id);
    });

    it("returns undefined for unknown surface", () => {
      const instance = manager.get("nonexistent");

      expect(instance).toBeUndefined();
    });
  });
});
