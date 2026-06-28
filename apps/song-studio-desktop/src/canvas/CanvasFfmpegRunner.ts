import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import ffmpegPath from 'ffmpeg-static';
import type { CanvasVideoSpec, FfmpegCommandPlan } from './types';

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

export interface CanvasVideoProbeResult {
  ok: boolean;
  spec?: CanvasVideoSpec;
  stderrTail?: string;
}

/**
 * Harness-only probe of a local video's spec by parsing `ffmpeg -i` output.
 *
 * ffmpeg-static ships ffmpeg (not ffprobe), so we run `ffmpeg -i <path>` with no
 * output — it exits non-zero and prints stream metadata to stderr, which we parse.
 * Local-only: reads a file path, makes no network/cloud/AI call.
 */
export async function probeVideoSpec(inputPath: string): Promise<CanvasVideoProbeResult> {
  if (!existsSync(inputPath)) return { ok: false, stderrTail: `Input video not found: ${inputPath}` };
  const ffmpeg = resolveCanvasHarnessFfmpeg();
  let stderr = '';
  try {
    // No output file -> ffmpeg exits non-zero; metadata still lands on stderr.
    await execFileAsync(ffmpeg, ['-hide_banner', '-i', inputPath], { maxBuffer: 1 << 27 });
  } catch (err: unknown) {
    const e = err as { stderr?: string; message?: string };
    stderr = String(e.stderr || e.message || err);
  }
  const durationMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const durationSec = durationMatch ? Number(durationMatch[1]) * 3600 + Number(durationMatch[2]) * 60 + parseFloat(durationMatch[3]) : NaN;
  const videoLine = stderr.split('\n').find((line) => /Video:/.test(line)) ?? '';
  const resolutionMatch = videoLine.match(/(\d{2,5})x(\d{2,5})/);
  const width = resolutionMatch ? Number(resolutionMatch[1]) : NaN;
  const height = resolutionMatch ? Number(resolutionMatch[2]) : NaN;
  const fpsMatch = videoLine.match(/(\d+(?:\.\d+)?)\s*fps/);
  const fps = fpsMatch ? parseFloat(fpsMatch[1]) : NaN;
  const codecMatch = videoLine.match(/Video:\s*([a-z0-9_]+)/i);
  if (!Number.isFinite(durationSec) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return { ok: false, stderrTail: stderr.split('\n').slice(-15).join('\n') };
  }
  const spec: CanvasVideoSpec = {
    filePath: inputPath,
    fileType: inputPath.split('.').pop()?.toLowerCase(),
    durationSec,
    width,
    height,
    fps: Number.isFinite(fps) ? fps : 30,
    codec: codecMatch?.[1],
    fileSizeBytes: statSync(inputPath).size,
  };
  return { ok: true, spec };
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
