// Node render engine — dev + verification path. Implements the SAME RenderEngine
// interface as the Tauri engine and reuses the SAME shared render logic
// (presets + buildFfmpegArgs). Uses ffmpeg-static so a real MP4 can be produced
// without the Rust/Tauri toolchain. Run with `tsx` (see package.json render:smoke).

import { execFile } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import { getPreset } from '../src/render/presets';
import { buildFfmpegArgs } from '../src/render/ffmpegArgs';
import type { RenderEngine, RenderJob, RenderResult, RenderLogFn } from '../src/render/types';

const run = promisify(execFile);
const FFMPEG = ffmpegPath as unknown as string;

function resolveFont(): string | null {
  const candidates = [
    'C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ];
  return candidates.find((p) => { try { return existsSync(p); } catch { return false; } }) ?? null;
}

export const nodeRenderEngine: RenderEngine = {
  async render(job: RenderJob, onLog?: RenderLogFn): Promise<RenderResult> {
    const preset = getPreset(job.presetId);
    if (!preset) return { ok: false, error: `Unknown preset "${job.presetId}"` };
    if (!existsSync(job.imagePath)) return { ok: false, error: `Cover not found: ${job.imagePath}` };
    if (preset.audio && job.audioPath && !existsSync(job.audioPath)) {
      return { ok: false, error: `Audio not found: ${job.audioPath}` };
    }
    mkdirSync(dirname(job.outputPath), { recursive: true });
    const args = buildFfmpegArgs(job, preset, { fontPath: resolveFont() });
    onLog?.(`[node-render] ${preset.label} -> ${job.outputPath}`);
    const start = Date.now();
    try {
      await run(FFMPEG, args, { maxBuffer: 1 << 27 });
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string };
      const tail = String(e.stderr || e.message || err).split('\n').slice(-15).join('\n');
      return { ok: false, error: tail, durationMs: Date.now() - start };
    }
    return { ok: true, outputPath: job.outputPath, bytes: statSync(job.outputPath).size, durationMs: Date.now() - start };
  },
};
