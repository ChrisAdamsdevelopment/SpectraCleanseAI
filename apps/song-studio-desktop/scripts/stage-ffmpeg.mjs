// Stage the FFmpeg sidecar for Tauri bundling (ALPHA-001 §1).
//
// Tauri's `bundle.externalBin` requires each binary to exist on disk with a
// `-$TARGET_TRIPLE` suffix. We copy the `ffmpeg-static` binary (already a
// dependency, already license-documented) into src-tauri/binaries/ under the
// name Tauri expects for the current host target.
//
// This runs from `beforeBuildCommand`, so a production bundle can never be
// produced without its video engine. Run standalone with:
//   node scripts/stage-ffmpeg.mjs [--target <triple>] [--check]

import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const OUT_DIR = join(APP, 'src-tauri', 'binaries');

function hostTriple() {
  const argIdx = process.argv.indexOf('--target');
  if (argIdx !== -1 && process.argv[argIdx + 1]) return process.argv[argIdx + 1];
  try {
    // Authoritative: ask rustc for the host tuple (documented Tauri guidance).
    const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
    const m = out.match(/host:\s*(\S+)/);
    if (m) return m[1];
  } catch { /* rustc unavailable — fall back to a platform guess below */ }
  const p = process.platform, a = process.arch;
  if (p === 'win32') return 'x86_64-pc-windows-msvc';
  if (p === 'darwin') return a === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
  return 'x86_64-unknown-linux-gnu';
}

function ffmpegSource() {
  // ffmpeg-static exposes the binary path as its default export at runtime, but
  // resolving the file directly keeps this script dependency-light.
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [
    join(APP, 'node_modules', 'ffmpeg-static', name),
    join(APP, '..', '..', 'node_modules', 'ffmpeg-static', name),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

function main() {
  const triple = hostTriple();
  const ext = triple.includes('windows') ? '.exe' : '';
  const dest = join(OUT_DIR, `ffmpeg-${triple}${ext}`);
  const checkOnly = process.argv.includes('--check');

  const src = ffmpegSource();
  if (!src) {
    console.error('[stage-ffmpeg] FAIL — ffmpeg-static binary not found. Run `npm install` first.');
    process.exit(1);
  }

  if (checkOnly) {
    const ok = existsSync(dest);
    console.log(`[stage-ffmpeg] target=${triple}`);
    console.log(`[stage-ffmpeg] sidecar ${ok ? 'PRESENT' : 'MISSING'} -> ${dest}`);
    process.exit(ok ? 0 : 1);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  copyFileSync(src, dest);
  const bytes = statSync(dest).size;
  if (bytes < 1_000_000) {
    console.error(`[stage-ffmpeg] FAIL — staged sidecar is implausibly small (${bytes} bytes).`);
    process.exit(1);
  }
  console.log(`[stage-ffmpeg] OK — ${src}`);
  console.log(`[stage-ffmpeg]   -> ${dest} (${(bytes / 1024 / 1024).toFixed(1)} MB, target ${triple})`);
}

main();
