// Reproducible smoke test for the Song Studio v0 render spike.
//
// Generates SYNTHETIC test assets (a tone + a solid-color cover) — never real
// music or artwork — then renders one audio-based vertical asset and one silent
// Canvas asset and verifies both outputs exist and are non-empty.
//
// Run:  npm run smoke
// All generated files land in out/ (gitignored); nothing is committed.

import { execFile } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';

const run = promisify(execFile);
const OUT = 'out';
const COVER = `${OUT}/_smoke_cover.png`;       // synthetic test cover (solid color)
const TONE = `${OUT}/_smoke_tone.m4a`;          // synthetic test audio (sine tone)
const TIKTOK_OUT = `${OUT}/_smoke_tiktok.mp4`;
const CANVAS_OUT = `${OUT}/_smoke_canvas.mp4`;

const ff = (args) => run(ffmpegPath, args, { maxBuffer: 1 << 26 });
const tail = (e, n = 8) => String(e?.stderr || e?.message || e).split('\n').slice(-n).join('\n');

async function generateSyntheticAssets() {
  console.log('[smoke] generating SYNTHETIC test assets (not real music/art)…');
  // Solid-color cover image — purely for validation.
  await ff(['-f', 'lavfi', '-i', 'color=c=0x14203a:s=1200x1200:d=1', '-frames:v', '1', '-y', COVER]);
  // Synthetic 10s sine tone — clearly NOT a real song.
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=10', '-c:a', 'aac', '-y', TONE]);
}

async function renderCheck(label, args, outFile) {
  process.stdout.write(`[smoke] render ${label} … `);
  try {
    await run(process.execPath, ['render.mjs', ...args], { maxBuffer: 1 << 26 });
  } catch (e) {
    console.log('FAIL (render error)');
    console.error(tail(e));
    return false;
  }
  const ok = existsSync(outFile) && statSync(outFile).size > 0;
  console.log(ok ? `OK (${(statSync(outFile).size / 1024).toFixed(0)} KB)` : 'FAIL (output missing or empty)');
  return ok;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  await generateSyntheticAssets();

  const results = [];
  results.push(await renderCheck(
    'tiktok (synthetic audio)',
    ['--format', 'tiktok', '--image', COVER, '--audio', TONE, '--title', 'Smoke Test', '--duration', '4', '--out', TIKTOK_OUT],
    TIKTOK_OUT,
  ));
  results.push(await renderCheck(
    'canvas (silent)',
    ['--format', 'canvas', '--image', COVER, '--title', 'Smoke Test', '--duration', '3', '--out', CANVAS_OUT],
    CANVAS_OUT,
  ));

  const passed = results.length === 2 && results.every(Boolean);
  console.log(passed
    ? '\n[smoke] PASS — rendered an audio asset and a silent Canvas asset; both files exist and are non-empty.'
    : '\n[smoke] FAIL — see errors above.');
  process.exit(passed ? 0 : 1);
}

main().catch((e) => { console.error('[smoke] unexpected error:\n' + tail(e, 12)); process.exit(1); });
