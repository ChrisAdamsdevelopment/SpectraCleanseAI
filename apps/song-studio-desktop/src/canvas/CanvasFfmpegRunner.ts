import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import type { FfmpegCommandPlan } from './types';

const execFileAsync = promisify(execFile);
const FFMPEG = ffmpegPath as unknown as string | null;

export interface CanvasFfmpegRunResult {
  ok: boolean;
  ffmpegPath: string;
  outputPath?: string;
  bytes?: number;
  stderrTail?: string;
  durationMs: number;
}

export function resolveCanvasHarnessFfmpeg(): string {
  const configured = process.env.SONG_STUDIO_FFMPEG;
  if (configured) return configured;
  if (FFMPEG) return FFMPEG;
  return 'ffmpeg';
}

/**
 * Harness-only FFmpeg executor for Node smoke scripts.
 *
 * Production rendering still goes through the Tauri `run_ffmpeg(args)` command.
 * Node smoke scripts cannot invoke that Tauri command, so this mirrors the
 * existing render-core smoke strategy: resolve SONG_STUDIO_FFMPEG first, then
 * ffmpeg-static, then system ffmpeg, and execute preplanned argument lists.
 */
export async function runCanvasFfmpegPlan(plan: FfmpegCommandPlan): Promise<CanvasFfmpegRunResult> {
  const ffmpeg = resolveCanvasHarnessFfmpeg();
  if (plan.outputPath && !plan.outputPath.includes('%')) mkdirSync(dirname(plan.outputPath), { recursive: true });
  const start = Date.now();
  try {
    await execFileAsync(ffmpeg, plan.args, { maxBuffer: 1 << 27 });
    const concreteOutput = plan.outputPath && !plan.outputPath.includes('%') ? plan.outputPath : undefined;
    return {
      ok: true,
      ffmpegPath: ffmpeg,
      outputPath: concreteOutput,
      bytes: concreteOutput && existsSync(concreteOutput) ? statSync(concreteOutput).size : undefined,
      durationMs: Date.now() - start,
    };
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    return { ok: false, ffmpegPath: ffmpeg, stderrTail: String(e.stderr || e.message || err).split('\n').slice(-15).join('\n'), durationMs: Date.now() - start };
  }
}

export async function generateCanvasFixtureVideo(outputPath: string, durationSec = 5): Promise<CanvasFfmpegRunResult> {
  mkdirSync(dirname(outputPath), { recursive: true });
  return runCanvasFfmpegPlan({
    description: 'Generate a tiny deterministic vertical Canvas fixture video for harness smoke tests.',
    requiresExecutionHook: 'run_ffmpeg',
    outputPath,
    args: [
      '-y',
      '-f', 'lavfi',
      '-i', `testsrc2=size=180x320:rate=12:duration=${durationSec}`,
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      outputPath,
    ],
  });
}
