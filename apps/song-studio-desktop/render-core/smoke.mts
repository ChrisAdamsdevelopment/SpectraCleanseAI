// Reproducible render verification. Generates SYNTHETIC test assets (a tone +
// a solid-color cover — never real music/art), renders one silent Canvas asset
// and one audio vertical-promo asset through the shared engine, and verifies
// both MP4s exist and are non-empty. Run: npm run render:smoke
// Generated files (.smoke-assets/, out/) are gitignored.

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

function makeAssets() {
  mkdirSync(ASSETS, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  console.log('[smoke] generating SYNTHETIC test assets (not real music/art)…');
  execFileSync(FFMPEG, ['-f', 'lavfi', '-i', 'color=c=0x14203a:s=1200x1200:d=1', '-frames:v', '1', '-y', COVER], { stdio: 'ignore' });
  execFileSync(FFMPEG, ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=8', '-c:a', 'aac', '-y', TONE], { stdio: 'ignore' });
}

async function main() {
  makeAssets();
  const jobs: Array<{ name: string; job: RenderJob }> = [
    {
      name: 'vertical_promo (audio)',
      job: { presetId: 'vertical_promo', imagePath: COVER, audioPath: TONE, title: 'Smoke Test', durationSec: 4, outputPath: `${OUT}/_smoke_promo.mp4` },
    },
    {
      name: 'canvas (silent)',
      job: { presetId: 'canvas', imagePath: COVER, title: 'Smoke Test', durationSec: 3, outputPath: `${OUT}/_smoke_canvas.mp4` },
    },
  ];

  let allOk = true;
  for (const { name, job } of jobs) {
    process.stdout.write(`[smoke] render ${name} … `);
    const res = await nodeRenderEngine.render(job, () => {});
    const ok = res.ok && existsSync(job.outputPath) && statSync(job.outputPath).size > 0;
    if (ok) console.log(`OK (${Math.round((res.bytes ?? 0) / 1024)} KB)`);
    else { console.log('FAIL'); console.error(res.error); }
    allOk = allOk && ok;
  }

  console.log(allOk
    ? '\n[smoke] PASS — rendered an audio asset and a silent Canvas asset; both files exist and are non-empty.'
    : '\n[smoke] FAIL — see errors above.');
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error('[smoke] unexpected error:', e); process.exit(1); });
