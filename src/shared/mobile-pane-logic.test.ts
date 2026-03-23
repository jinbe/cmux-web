import { describe, it, expect } from "vitest";
import {
  MOBILE_BREAKPOINT_PX,
  SWIPE_THRESHOLD_PX,
  isMobile,
  resolveActionToDirection,
  resolveSwipe,
  type SwipeInput,
} from "./mobile-pane-logic.js";

// --- isMobile ---

describe("isMobile", () => {
  it("returns true at the breakpoint boundary (768px)", () => {
    expect(isMobile(MOBILE_BREAKPOINT_PX)).toBe(true);
  });

  it("returns true below the breakpoint", () => {
    expect(isMobile(375)).toBe(true);
    expect(isMobile(480)).toBe(true);
    expect(isMobile(767)).toBe(true);
  });

  it("returns false above the breakpoint", () => {
    expect(isMobile(769)).toBe(false);
    expect(isMobile(1024)).toBe(false);
    expect(isMobile(1920)).toBe(false);
  });

  it("uses 768 as the mobile breakpoint (not 480)", () => {
    // Ensures the old isSmallMobile 480px threshold is gone
    expect(MOBILE_BREAKPOINT_PX).toBe(768);
    expect(isMobile(480)).toBe(true);
    expect(isMobile(600)).toBe(true);
  });
});

// --- resolveActionToDirection ---

describe("resolveActionToDirection", () => {
  it("maps new-pane to right (same as split-right)", () => {
    expect(resolveActionToDirection("new-pane")).toBe("right");
  });

  it("maps split-right to right", () => {
    expect(resolveActionToDirection("split-right")).toBe("right");
  });

  it("maps split-down to down", () => {
    expect(resolveActionToDirection("split-down")).toBe("down");
  });

  it("new-pane and split-right produce identical results", () => {
    expect(resolveActionToDirection("new-pane")).toBe(
      resolveActionToDirection("split-right"),
    );
  });

  it("returns null for non-split actions", () => {
    expect(resolveActionToDirection("new-workspace")).toBeNull();
    expect(resolveActionToDirection("close-surface")).toBeNull();
    expect(resolveActionToDirection("unknown")).toBeNull();
  });
});

// --- resolveSwipe ---

function makeSwipeInput(overrides: Partial<SwipeInput> = {}): SwipeInput {
  return {
    deltaX: 0,
    touchStartX: 100,
    elapsed: 100,
    deltaY: 0,
    sidebarOpen: false,
    surfaceIds: ["s1", "s2", "s3"],
    focusedSurfaceId: "s2",
    ...overrides,
  };
}

describe("resolveSwipe", () => {
  describe("gesture filtering", () => {
    it("ignores slow swipes (> 300ms)", () => {
      const result = resolveSwipe(
        makeSwipeInput({ deltaX: -100, elapsed: 301 }),
      );
      expect(result.type).toBe("none");
    });

    it("ignores vertical swipes", () => {
      const result = resolveSwipe(
        makeSwipeInput({ deltaX: -60, deltaY: 80 }),
      );
      expect(result.type).toBe("none");
    });
  });

  describe("sidebar gestures", () => {
    it("opens sidebar on right-swipe from left edge", () => {
      const result = resolveSwipe(
        makeSwipeInput({
          deltaX: SWIPE_THRESHOLD_PX + 10,
          touchStartX: 15,
        }),
      );
      expect(result).toEqual({ type: "open-sidebar" });
    });

    it("does not open sidebar if swipe starts away from left edge", () => {
      const result = resolveSwipe(
        makeSwipeInput({
          deltaX: SWIPE_THRESHOLD_PX + 10,
          touchStartX: 50,
        }),
      );
      // Should be a pane switch, not sidebar open
      expect(result.type).not.toBe("open-sidebar");
    });

    it("closes sidebar on left-swipe when sidebar is open", () => {
      const result = resolveSwipe(
        makeSwipeInput({
          deltaX: -(SWIPE_THRESHOLD_PX + 10),
          sidebarOpen: true,
        }),
      );
      expect(result).toEqual({ type: "close-sidebar" });
    });

    it("sidebar close takes priority over pane switching", () => {
      const result = resolveSwipe(
        makeSwipeInput({
          deltaX: -(SWIPE_THRESHOLD_PX + 10),
          sidebarOpen: true,
          focusedSurfaceId: "s1",
        }),
      );
      expect(result.type).toBe("close-sidebar");
    });
  });

  describe("pane switching", () => {
    it("swipe left switches to next surface", () => {
      const result = resolveSwipe(
        makeSwipeInput({
          deltaX: -(SWIPE_THRESHOLD_PX + 10),
          focusedSurfaceId: "s1",
        }),
      );
      expect(result).toEqual({ type: "switch-surface", surfaceId: "s2" });
    });

    it("swipe right switches to previous surface", () => {
      const result = resolveSwipe(
        makeSwipeInput({
          deltaX: SWIPE_THRESHOLD_PX + 10,
          focusedSurfaceId: "s2",
        }),
      );
      expect(result).toEqual({ type: "switch-surface", surfaceId: "s1" });
    });

    it("does not go past the last surface", () => {
      const result = resolveSwipe(
        makeSwipeInput({
          deltaX: -(SWIPE_THRESHOLD_PX + 10),
          focusedSurfaceId: "s3",
        }),
      );
      expect(result.type).toBe("none");
    });

    it("does not go before the first surface", () => {
      const result = resolveSwipe(
        makeSwipeInput({
          deltaX: SWIPE_THRESHOLD_PX + 10,
          focusedSurfaceId: "s1",
        }),
      );
      expect(result.type).toBe("none");
    });

    it("returns none when no surfaces exist", () => {
      const result = resolveSwipe(
        makeSwipeInput({
          deltaX: -(SWIPE_THRESHOLD_PX + 10),
          surfaceIds: [],
          focusedSurfaceId: null,
        }),
      );
      expect(result.type).toBe("none");
    });

    it("returns none when focused surface is not in the list", () => {
      const result = resolveSwipe(
        makeSwipeInput({
          deltaX: -(SWIPE_THRESHOLD_PX + 10),
          focusedSurfaceId: "unknown",
        }),
      );
      expect(result.type).toBe("none");
    });

    it("does not switch panes when sidebar is open", () => {
      const result = resolveSwipe(
        makeSwipeInput({
          deltaX: SWIPE_THRESHOLD_PX + 10,
          sidebarOpen: true,
          touchStartX: 100,
          focusedSurfaceId: "s2",
        }),
      );
      // Sidebar is open, so no pane switch (but also not sidebar open since not from edge)
      expect(result.type).not.toBe("switch-surface");
    });

    it("handles swipe below threshold", () => {
      const result = resolveSwipe(
        makeSwipeInput({
          deltaX: SWIPE_THRESHOLD_PX - 1,
        }),
      );
      expect(result.type).toBe("none");
    });
  });
});
