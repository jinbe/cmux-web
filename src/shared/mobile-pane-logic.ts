/**
 * Mobile pane navigation — pure logic for swipe-to-switch and action mapping.
 * Extracted for testability; used by app.js at runtime.
 *
 * Keep MOBILE_BREAKPOINT_PX in sync with app.js, layout-renderer.js,
 * and style.css @media (max-width: 768px).
 */

export const MOBILE_BREAKPOINT_PX = 768;
export const SWIPE_THRESHOLD_PX = 50;

/**
 * Determine whether the viewport width counts as mobile.
 */
export function isMobile(viewportWidth: number): boolean {
  return viewportWidth <= MOBILE_BREAKPOINT_PX;
}

/**
 * Resolve an action-menu action to a split direction, or null for non-split actions.
 * "new-pane" is treated identically to "split-right" (on mobile the direction is irrelevant).
 */
export function resolveActionToDirection(
  action: string,
): "right" | "down" | null {
  switch (action) {
    case "new-pane":
    case "split-right":
      return "right";
    case "split-down":
      return "down";
    default:
      return null;
  }
}

export interface SwipeInput {
  deltaX: number;
  touchStartX: number;
  elapsed: number;
  deltaY: number;
  sidebarOpen: boolean;
  surfaceIds: string[];
  focusedSurfaceId: string | null;
}

export type SwipeResult =
  | { type: "open-sidebar" }
  | { type: "close-sidebar" }
  | { type: "switch-surface"; surfaceId: string }
  | { type: "none" };

/**
 * Determine the result of a swipe gesture on mobile.
 * Returns the action to take (open/close sidebar, switch surface, or nothing).
 */
export function resolveSwipe(input: SwipeInput): SwipeResult {
  const { deltaX, touchStartX, elapsed, deltaY, sidebarOpen, surfaceIds, focusedSurfaceId } =
    input;

  // Only count quick, predominantly-horizontal swipes
  if (elapsed > 300 || Math.abs(deltaY) > Math.abs(deltaX)) {
    return { type: "none" };
  }

  // Swipe right from left edge → open sidebar
  if (deltaX > SWIPE_THRESHOLD_PX && touchStartX < 30) {
    return { type: "open-sidebar" };
  }

  // Swipe left while sidebar is open → close it
  if (deltaX < -SWIPE_THRESHOLD_PX && sidebarOpen) {
    return { type: "close-sidebar" };
  }

  // Swipe left/right to switch between surfaces
  if (Math.abs(deltaX) > SWIPE_THRESHOLD_PX && !sidebarOpen) {
    if (!focusedSurfaceId || surfaceIds.length === 0) {
      return { type: "none" };
    }

    const currentIndex = surfaceIds.indexOf(focusedSurfaceId);
    if (currentIndex === -1) {
      return { type: "none" };
    }

    let nextIndex: number;
    if (deltaX < -SWIPE_THRESHOLD_PX) {
      // Swipe left → next surface
      nextIndex = Math.min(currentIndex + 1, surfaceIds.length - 1);
    } else {
      // Swipe right → previous surface
      nextIndex = Math.max(currentIndex - 1, 0);
    }

    if (nextIndex !== currentIndex) {
      return { type: "switch-surface", surfaceId: surfaceIds[nextIndex] };
    }
  }

  return { type: "none" };
}
