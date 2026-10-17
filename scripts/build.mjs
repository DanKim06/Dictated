// Builds the main process, preload script, renderer and native helper into dist/.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const production = process.argv.includes("--production");

fs.rmSync(dist, { recursive: true, force: true });

const shared = { bundle: true, sourcemap: !production, minify: production, logLevel: "warning" };

await Promise.all([
  esbuild.build({
    ...shared,
    entryPoints: ["src/main/main.ts"],
    outfile: "dist/main/main.js",
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
  }),
  esbuild.build({
    ...shared,
    entryPoints: ["src/preload/preload.ts"],
    outfile: "dist/preload/preload.js",
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
  }),
  esbuild.build({
    ...shared,
    entryPoints: {
      app: "src/renderer/app.ts",
      "whisper.worker": "src/renderer/transcription/whisper.worker.ts",
    },
    outdir: "dist/renderer",
    platform: "browser",
    format: "esm",
    target: "chrome130",
  }),
  esbuild.build({
    ...shared,
    entryPoints: ["src/renderer/audio/pcm-worklet.ts"],
    outfile: "dist/renderer/pcm-worklet.js",
    platform: "browser",
    format: "iife",
    target: "chrome130",
  }),
]);

for (const file of ["index.html", "styles.css"]) {
  fs.copyFileSync(path.join(root, "src/renderer", file), path.join(dist, "renderer", file));
}

// ONNX Runtime's WebAssembly build, served locally so on-device transcription
// works offline and doesn't load code from a CDN.
const ortDir = path.join(root, "node_modules/onnxruntime-web/dist");
fs.mkdirSync(path.join(dist, "renderer/ort"), { recursive: true });
for (const file of ["ort-wasm-simd-threaded.asyncify.mjs", "ort-wasm-simd-threaded.asyncify.wasm"]) {
  fs.copyFileSync(path.join(ortDir, file), path.join(dist, "renderer/ort", file));
}

// macOS meeting detection helper (Swift, Core Audio).
if (process.platform === "darwin") {
  fs.mkdirSync(path.join(dist, "bin"), { recursive: true });
  try {
    execFileSync("swiftc", ["-O", "native/macos/MicMonitor.swift", "-o", "dist/bin/mic-monitor"], {
      cwd: root,
      stdio: "inherit",
    });
  } catch {
    console.warn("swiftc not found: meeting auto-detection is disabled. Install Xcode Command Line Tools.");
  }
}

console.log(`Built Dictated into ${path.relative(process.cwd(), dist) || "dist"}/`);
