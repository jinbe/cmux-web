/**
 * Build script for cmux-web server + CLI.
 * Uses Bun's built-in bundler to compile TypeScript to ESM.
 */

import * as path from "node:path";
import * as fs from "node:fs";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(__dirname, "..");

async function build() {
  // Server build
  const serverResult = await Bun.build({
    entrypoints: [path.join(root, "src/server/index.ts")],
    outdir: path.join(root, "dist/server"),
    target: "bun",
    format: "esm",
    sourcemap: "linked",
    external: ["bun-pty"],
  });

  if (!serverResult.success) {
    console.error("Server build failed:");
    for (const log of serverResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // CLI build
  const cliResult = await Bun.build({
    entrypoints: [path.join(root, "src/cli/index.ts")],
    outdir: path.join(root, "dist/cli"),
    target: "bun",
    format: "esm",
    sourcemap: "linked",
  });

  if (!cliResult.success) {
    console.error("CLI build failed:");
    for (const log of cliResult.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  // Add shebang to CLI entry point
  const cliEntryPath = path.join(root, "dist/cli/index.js");
  const cliContent = fs.readFileSync(cliEntryPath, "utf8");
  if (!cliContent.startsWith("#!/")) {
    fs.writeFileSync(cliEntryPath, `#!/usr/bin/env bun\n${cliContent}`);
    fs.chmodSync(cliEntryPath, 0o755);
  }

  // Copy public directory
  const publicSrc = path.join(root, "public");
  const publicDest = path.join(root, "dist/public");
  fs.cpSync(publicSrc, publicDest, { recursive: true });

  // Copy ghostty-web files
  const ghosttyWebSrc = path.join(root, "node_modules/ghostty-web/dist/ghostty-web.js");
  const ghosttyWebDest = path.join(root, "dist/public/lib/ghostty-web.js");
  fs.mkdirSync(path.dirname(ghosttyWebDest), { recursive: true });
  fs.copyFileSync(ghosttyWebSrc, ghosttyWebDest);

  const ghosttyWasmSrc = path.join(root, "node_modules/ghostty-web/dist/ghostty-vt.wasm");
  const ghosttyWasmDest = path.join(root, "dist/public/ghostty-vt.wasm");
  fs.copyFileSync(ghosttyWasmSrc, ghosttyWasmDest);

  console.log("Build complete!");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
