import { existsSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ExtractedFrame, FfmpegCommandPlan, FrameMetrics } from './types';
import { runCanvasFfmpegPlan } from './CanvasFfmpegRunner';

export function planFixedFpsFrameExtraction(inputPath: string, outputPattern: string, fps = 8, maxWidth = 360): FfmpegCommandPlan {
  return { description: 'Extract low-resolution analysis frames at a fixed FPS.', requiresExecutionHook: 'run_ffmpeg', outputPath: outputPattern, args: ['-y', '-i', inputPath, '-vf', `fps=${fps},scale=${maxWidth}:-2`, outputPattern] };
}

export function planAnchorFrameExtraction(inputPath: string, outputPath: string, timestampSec: number, maxWidth = 720): FfmpegCommandPlan {
  return { description: 'Extract a single creator-selected anchor frame.', requiresExecutionHook: 'run_ffmpeg', outputPath, args: ['-y', '-ss', String(Math.max(0, timestampSec)), '-i', inputPath, '-frames:v', '1', '-vf', `scale=${maxWidth}:-2`, outputPath] };
}

export function planCandidateFrameExtraction(inputPath: string, outputPattern: string, startSec: number, durationSec: number, fps = 12): FfmpegCommandPlan {
  return { description: 'Extract denser candidate frames into a cache/lab directory.', requiresExecutionHook: 'run_ffmpeg', outputPath: outputPattern, args: ['-y', '-ss', String(Math.max(0, startSec)), '-t', String(Math.max(0.1, durationSec)), '-i', inputPath, '-vf', `fps=${fps},scale=360:-2`, outputPattern] };
}

export interface HarnessExtractionOptions {
  sourceId: string;
  startSec?: number;
  fps?: number;
  maxWidth?: number;
}

function conservativeHarnessMetrics(frameIndex: number, totalFrames: number, isAnchor = false): FrameMetrics {
  // Placeholder only: real image metric extraction is intentionally a follow-up.
  // Values vary gently so scorer/candidate/report plumbing can be exercised
  // without claiming perceptual analysis accuracy.
  const phase = totalFrames <= 1 ? 0 : frameIndex / Math.max(1, totalFrames - 1);
  return {
    visualSimilarity: isAnchor ? 1 : Math.max(0.45, 0.88 - Math.abs(phase - 0.75) * 0.24),
    brightness: 0.48 + phase * 0.08,
    colorVector: [120 + Math.round(phase * 10), 80 + Math.round(phase * 6), 200 - Math.round(phase * 8)],
    motionMagnitude: 0.2 + phase * 0.08,
  };
}

function framesFromPattern(outputPattern: string, sourceId: string, fps: number, startSec = 0): ExtractedFrame[] {
  const dir = dirname(outputPattern);
  const patternName = basename(outputPattern);
  const matcher = new RegExp(`^${patternName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%0?\dd/g, '\\d+')}$`);
  const files = readdirSync(dir)
    .filter((name) => matcher.test(name))
    .sort((a, b) => a.localeCompare(b));
  return files.map((file, index) => ({
    sourceId,
    framePath: join(dir, file),
    timestampSec: startSec + index / fps,
    frameIndex: Math.round((startSec + index / fps) * fps),
    checksum: `${statSync(join(dir, file)).size}-bytes`,
    metrics: conservativeHarnessMetrics(index, files.length),
  }));
}

export async function extractFixedFpsFramesForHarness(inputPath: string, outputPattern: string, options: HarnessExtractionOptions): Promise<{ plan: FfmpegCommandPlan; frames: ExtractedFrame[] }> {
  const fps = options.fps ?? 2;
  const plan = planFixedFpsFrameExtraction(inputPath, outputPattern, fps, options.maxWidth ?? 360);
  const result = await runCanvasFfmpegPlan(plan);
  if (!result.ok) throw new Error(`Canvas frame extraction failed: ${result.stderrTail ?? 'unknown FFmpeg error'}`);
  return { plan, frames: framesFromPattern(outputPattern, options.sourceId, fps, options.startSec ?? 0) };
}

export async function extractCandidateFramesForHarness(inputPath: string, outputPattern: string, startSec: number, durationSec: number, options: HarnessExtractionOptions): Promise<{ plan: FfmpegCommandPlan; frames: ExtractedFrame[] }> {
  const fps = options.fps ?? 2;
  const plan = planCandidateFrameExtraction(inputPath, outputPattern, startSec, durationSec, fps);
  const result = await runCanvasFfmpegPlan(plan);
  if (!result.ok) throw new Error(`Canvas candidate extraction failed: ${result.stderrTail ?? 'unknown FFmpeg error'}`);
  return { plan, frames: framesFromPattern(outputPattern, options.sourceId, fps, startSec) };
}

export async function extractAnchorFrameForHarness(inputPath: string, outputPath: string, timestampSec: number, options: HarnessExtractionOptions): Promise<{ plan: FfmpegCommandPlan; frame: ExtractedFrame }> {
  const fps = options.fps ?? 12;
  const plan = planAnchorFrameExtraction(inputPath, outputPath, timestampSec, options.maxWidth ?? 720);
  const result = await runCanvasFfmpegPlan(plan);
  if (!result.ok || !existsSync(outputPath)) throw new Error(`Canvas anchor extraction failed: ${result.stderrTail ?? 'missing anchor frame'}`);
  return {
    plan,
    frame: {
      sourceId: options.sourceId,
      framePath: outputPath,
      timestampSec,
      frameIndex: Math.round(timestampSec * fps),
      checksum: `${statSync(outputPath).size}-bytes`,
      metrics: conservativeHarnessMetrics(0, 1, true),
    },
  };
}
