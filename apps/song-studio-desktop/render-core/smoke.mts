// Reproducible render verification. Generates SYNTHETIC test assets (a tone +
// a solid-color cover — never real music/art), renders one silent Canvas asset
// and the audio promo/visualizer recipes (exercising each visual template and a
// clip start offset), and verifies every MP4 exists and is non-empty.
// Run: npm run render:smoke   (generated files in out/ are gitignored)

import { execFileSync } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import ffmpegPath from 'ffmpeg-static';
import { nodeRenderEngine } from './render.mts';
import type { RenderJob } from '../src/render/types';

const FFMPEG = ffmpegPath as unknown as string;
const ASSETS = 'render-core/.smoke-assets';
const OUT = 'out';
const COVER = `${ASSETS}/cover.png`;
const TONE = `${ASSETS}/tone.m4a`;
// VIDEO-002: a DISTINCT solid color (bright orange) so a directed visual can be
// told apart from the dark-navy cover by frame-sampling the real MP4.
const DIRECTED = `${ASSETS}/directed.png`;

function makeAssets() {
  mkdirSync(ASSETS, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  console.log('[smoke] generating SYNTHETIC test assets (not real music/art)…');
  execFileSync(FFMPEG, ['-f', 'lavfi', '-i', 'color=c=0x14203a:s=1200x1200:d=1', '-frames:v', '1', '-y', COVER], { stdio: 'ignore' });
  execFileSync(FFMPEG, ['-f', 'lavfi', '-i', 'color=c=0xff7700:s=1200x1200:d=1', '-frames:v', '1', '-y', DIRECTED], { stdio: 'ignore' });
  execFileSync(FFMPEG, ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=12', '-c:a', 'aac', '-y', TONE], { stdio: 'ignore' });
}

// Average frame color at a timestamp: scale the whole frame to 1x1 (which
// averages every pixel) and read the raw RGB bytes. Deterministic, no parsing.
function sampleAvgColor(mp4: string, timeSec: number): { r: number; g: number; b: number } {
  const buf = execFileSync(
    FFMPEG,
    ['-ss', String(timeSec), '-i', mp4, '-frames:v', '1', '-vf', 'scale=1:1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { maxBuffer: 1 << 20 },
  );
  return { r: buf[0] ?? 0, g: buf[1] ?? 0, b: buf[2] ?? 0 };
}

async function main() {
  makeAssets();
  const cases: Array<{ name: string; job: RenderJob }> = [
    { name: 'clean_canvas (silent)',     job: { recipeId: 'clean_canvas',     imagePath: COVER, title: 'Smoke Test', durationSec: 3, outputPath: `${OUT}/_smoke_canvas.mp4` } },
    { name: 'vertical_promo (audio)',    job: { recipeId: 'vertical_promo',    imagePath: COVER, audioPath: TONE, title: 'Smoke Test', durationSec: 4, audioStartSec: 2, outputPath: `${OUT}/_smoke_promo.mp4` } },
    { name: 'dark_street_hook (audio)',  job: { recipeId: 'dark_street_hook',  imagePath: COVER, audioPath: TONE, title: 'Smoke Test', durationSec: 4, audioStartSec: 0, outputPath: `${OUT}/_smoke_dark.mp4` } },
    { name: 'neon_visualizer (audio)',   job: { recipeId: 'neon_visualizer',   imagePath: COVER, audioPath: TONE, title: 'Smoke Test', durationSec: 4, audioStartSec: 0, outputPath: `${OUT}/_smoke_neon.mp4` } },
  ];

  let allOk = true;
  for (const { name, job } of cases) {
    process.stdout.write(`[smoke] render ${name} … `);
    const res = await nodeRenderEngine.render(job, () => {});
    const ok = res.ok && existsSync(job.outputPath) && statSync(job.outputPath).size > 0;
    if (ok) console.log(`OK (${Math.round((res.bytes ?? 0) / 1024)} KB)`);
    else { console.log('FAIL'); console.error(res.error); }
    allOk = allOk && ok;
  }

  // ── VIDEO-002 causal-direction export proof ────────────────────────────────
  // Render one audio promo with a directed visual over OUTPUT-LOCAL [1s,3s] of a
  // 4s clip, then sample the REAL MP4: inside the span the frame must be the
  // orange directed asset; outside it must be the navy cover state. This proves
  // the creator decision visibly and testably changed the export at the chosen
  // time — not from args or UI state, but from actual decoded pixels.
  process.stdout.write('[smoke] VIDEO-002 directed visual … ');
  const directedPath = `${OUT}/_smoke_directed.mp4`;
  const directedJob: RenderJob = {
    recipeId: 'vertical_promo', imagePath: COVER, audioPath: TONE, title: 'Directed', durationSec: 4, audioStartSec: 0,
    directedVisuals: [{ imagePath: DIRECTED, startSec: 1, endSec: 3 }], outputPath: directedPath,
  };
  const directedRes = await nodeRenderEngine.render(directedJob, () => {});
  let directedOk = directedRes.ok && existsSync(directedPath) && statSync(directedPath).size > 0;
  if (!directedOk) { console.log('FAIL (render)'); console.error(directedRes.error); }
  else {
    const inside = sampleAvgColor(directedPath, 2.0);   // within [1,3] → directed (orange)
    const before = sampleAvgColor(directedPath, 0.3);   // before span → cover (navy)
    const after = sampleAvgColor(directedPath, 3.7);    // after span → cover (navy)
    // Baseline (no direction) must remain the cover state at the SAME 2.0s.
    const baselinePath = `${OUT}/_smoke_directed_baseline.mp4`;
    const baseRes = await nodeRenderEngine.render({ ...directedJob, directedVisuals: [], outputPath: baselinePath }, () => {});
    const baseInside = baseRes.ok ? sampleAvgColor(baselinePath, 2.0) : { r: 999, g: 0, b: 0 };

    const insideIsOrange = inside.r > 150 && inside.r > inside.b + 60;
    const beforeIsCover = before.r < 90 && before.b >= before.r;
    const afterIsCover = after.r < 90 && after.b >= after.r;
    const baselineUnchanged = baseInside.r < 90; // no direction → still navy at 2.0s
    directedOk = insideIsOrange && beforeIsCover && afterIsCover && baselineUnchanged;
    if (directedOk) {
      console.log('OK');
      console.log(`[smoke]   inside 2.0s rgb(${inside.r},${inside.g},${inside.b}) = directed; before 0.3s rgb(${before.r},${before.g},${before.b}) & after 3.7s rgb(${after.r},${after.g},${after.b}) = cover; baseline@2.0s rgb(${baseInside.r},${baseInside.g},${baseInside.b}) unchanged.`);
    } else {
      console.log('FAIL (pixels)');
      console.error({ inside, before, after, baseInside });
    }
  }
  allOk = allOk && directedOk;

  console.log(allOk
    ? '\n[smoke] PASS — Canvas + 3 audio templates rendered; VIDEO-002 directed visual verified from real MP4 pixels; all files exist and are non-empty.'
    : '\n[smoke] FAIL — see errors above.');
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error('[smoke] unexpected error:', e); process.exit(1); });
