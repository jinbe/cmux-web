#!/usr/bin/env node
/**
 * Moravec CLI — cmux-compatible command-line interface.
 *
 * Controls workspaces, surfaces, and splits via the Unix domain socket.
 * Mirrors cmux's CLI surface so existing scripts and integrations work.
 */

import { Command } from "commander";
import { request } from "./client.js";

const program = new Command();

program
  .name("moravec")
  .description("Web-based terminal multiplexer — cmux for the browser")
  .version("0.1.0");

// --- Workspace commands ---

const workspace = program.command("workspace").description("Manage workspaces");

workspace
  .command("list")
  .description("List all workspaces")
  .action(async () => {
    const result = await request("workspace.list");
    const workspaces = result.workspaces ?? [];
    if (workspaces.length === 0) {
      console.log("No workspaces.");
      return;
    }
    for (const ws of workspaces) {
      const surfaceCount = ws.surfaces?.length ?? 0;
      console.log(`  ${ws.id}  ${ws.name}  (${surfaceCount} surface${surfaceCount !== 1 ? "s" : ""})`);
    }
  });

workspace
  .command("create")
  .description("Create a new workspace")
  .option("-n, --name <name>", "Workspace name")
  .action(async (opts) => {
    const result = await request("workspace.create", { name: opts.name });
    console.log(`Created workspace ${result.workspace_id} with surface ${result.surface_id}`);
  });

workspace
  .command("current")
  .description("Show the active workspace")
  .action(async () => {
    const result = await request("workspace.current");
    const ws = result.workspace;
    console.log(`  ${ws.id}  ${ws.name}`);
    for (const s of ws.surfaces ?? []) {
      console.log(`    └─ ${s.id}  ${s.title}  ${s.cols}x${s.rows}`);
    }
  });

workspace
  .command("select <workspaceId>")
  .description("Switch to a workspace")
  .action(async (workspaceId: string) => {
    await request("workspace.select", { workspace_id: workspaceId });
    console.log(`Switched to workspace ${workspaceId}`);
  });

workspace
  .command("close <workspaceId>")
  .description("Close a workspace")
  .action(async (workspaceId: string) => {
    await request("workspace.close", { workspace_id: workspaceId });
    console.log(`Closed workspace ${workspaceId}`);
  });

// --- Surface commands ---

const surface = program.command("surface").description("Manage surfaces (terminal panes)");

surface
  .command("list")
  .description("List all surfaces across workspaces")
  .action(async () => {
    const result = await request("surface.list");
    const surfaces = result.surfaces ?? [];
    if (surfaces.length === 0) {
      console.log("No surfaces.");
      return;
    }
    for (const s of surfaces) {
      console.log(`  ${s.id}  ${s.title}  ${s.cols}x${s.rows}  [${s.workspace_name}]`);
    }
  });

surface
  .command("split <surfaceId>")
  .description("Split a surface")
  .option("-d, --direction <dir>", "Split direction: right or down", "right")
  .action(async (surfaceId: string, opts) => {
    const result = await request("surface.split", {
      surface_id: surfaceId,
      direction: opts.direction,
    });
    console.log(`Split surface. New surface: ${result.surface_id}`);
  });

surface
  .command("close <surfaceId>")
  .description("Close a surface")
  .action(async (surfaceId: string) => {
    await request("surface.close", { surface_id: surfaceId });
    console.log(`Closed surface ${surfaceId}`);
  });

surface
  .command("send-text <surfaceId> <text>")
  .description("Send text to a surface")
  .action(async (surfaceId: string, text: string) => {
    await request("surface.send_text", {
      surface_id: surfaceId,
      text,
    });
    console.log("Text sent.");
  });

// --- Convenience shortcuts (cmux-style) ---

program
  .command("split")
  .description("Split the current/first surface (shortcut)")
  .option("-d, --direction <dir>", "Split direction: right or down", "right")
  .action(async (opts) => {
    // Get first surface from current workspace
    const wsResult = await request("workspace.current");
    const surfaces = wsResult.workspace?.surfaces ?? [];
    if (surfaces.length === 0) {
      console.error("No surfaces available to split.");
      process.exit(1);
    }
    const surfaceId = surfaces[surfaces.length - 1].id;
    const result = await request("surface.split", {
      surface_id: surfaceId,
      direction: opts.direction,
    });
    console.log(`Split surface. New surface: ${result.surface_id}`);
  });

program
  .command("ping")
  .description("Check if moravec server is running")
  .action(async () => {
    const result = await request("system.ping");
    console.log(`pong (v${result.version})`);
  });

// --- Error handling ---

program.hook("preAction", () => {
  // Nothing needed, but keeps the hook chain
});

program.parseAsync(process.argv).catch((err: any) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
