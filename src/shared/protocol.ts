/**
 * Shared protocol types for moravec.
 *
 * WebSocket messages between server and client use newline-delimited JSON,
 * matching cmux's v2 protocol style for compatibility.
 */

// --- Session/pane model ---

export interface MoravecWorkspace {
  id: string;
  name: string;
  surfaces: MoravecSurface[];
  layout: SplitLayout;
  createdAt: number;
}

export interface MoravecSurface {
  id: string;
  workspaceId: string;
  title: string;
  cwd: string;
  cols: number;
  rows: number;
  createdAt: number;
}

/**
 * Recursive split layout tree.
 * A leaf node has a `surfaceId`.
 * A branch node has `direction` and `children`.
 */
export type SplitLayout =
  | { type: "leaf"; surfaceId: string }
  | { type: "split"; direction: "horizontal" | "vertical"; children: SplitLayout[]; ratios: number[] };

// --- WebSocket messages (client <-> server) ---

/** Client -> Server */
export type ClientMessage =
  | { type: "workspace.list"; id: string }
  | { type: "workspace.create"; id: string; params?: { name?: string } }
  | { type: "workspace.close"; id: string; params: { workspaceId: string } }
  | { type: "surface.create"; id: string; params: { workspaceId: string } }
  | { type: "surface.close"; id: string; params: { surfaceId: string } }
  | { type: "surface.split"; id: string; params: { surfaceId: string; direction: "right" | "down" } }
  | { type: "surface.resize"; id: string; params: { surfaceId: string; cols: number; rows: number } }
  | { type: "surface.focus"; id: string; params: { surfaceId: string } }
  | { type: "surface.input"; id: string; params: { surfaceId: string; data: string } }
  | { type: "surface.set_ratios"; id: string; params: { surfaceId: string; ratios: number[] } }
  | { type: "workspace.select"; id: string; params: { workspaceId: string } };

/** Server -> Client */
export type ServerMessage =
  | { type: "response"; id: string; ok: true; result: any }
  | { type: "response"; id: string; ok: false; error: { code: string; message: string } }
  | { type: "surface.output"; surfaceId: string; data: string }
  | { type: "surface.exit"; surfaceId: string; exitCode: number }
  | { type: "surface.title"; surfaceId: string; title: string }
  | { type: "workspace.updated"; workspace: MoravecWorkspace }
  | { type: "state.sync"; workspaces: MoravecWorkspace[]; activeWorkspaceId: string | null };

// --- CLI socket protocol (cmux-compatible) ---

export interface CliRequest {
  id: string;
  method: string;
  params: Record<string, any>;
}

export interface CliResponse {
  id: string;
  ok: boolean;
  result?: any;
  error?: { code: string; message: string };
}

// --- Constants ---

export const DEFAULT_PORT = 7681;
export const DEFAULT_SOCKET_PATH = "/tmp/moravec.sock";
export const HEARTBEAT_INTERVAL_MS = 30_000;
