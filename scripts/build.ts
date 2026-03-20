/**
 * Build script for moravec server + CLI.
 * Uses esbuild to compile TypeScript to ESM.
 */

import * as esbuild from "esbuild";
import * as path from "node:path";
import * as fs from "node:fs";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(__dirname, "..");

async function build() {
  // Server build
  await esbuild.build({
    entryPoints: [path.join(root, "src/server/index.ts")],
    outdir: path.join(root, "dist/server"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: true,
    external: ["node-pty"],
    banner: {
      js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
    },
  });

  // CLI build
  await esbuild.build({
    entryPoints: [path.join(root, "src/cli/index.ts")],
    outdir: path.join(root, "dist/cli"),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    sourcemap: true,
    banner: {
      js: '#!/usr/bin/env node\nimport { createRequire } from "module"; const require = createRequire(import.meta.url);',
    },
  });

  // Copy public directory
  const publicSrc = path.join(root, "public");
  const publicDest = path.join(root, "dist/public");
  fs.cpSync(publicSrc, publicDest, { recursive: true });

  console.log("Build complete!");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
