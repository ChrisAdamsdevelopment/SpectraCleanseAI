import type { FfmpegCommandPlan } from './types';

export function planFixedFpsFrameExtraction(inputPath: string, outputPattern: string, fps = 8, maxWidth = 360): FfmpegCommandPlan {
  return { description: 'Extract low-resolution analysis frames at a fixed FPS.', requiresExecutionHook: 'run_ffmpeg', outputPath: outputPattern, args: ['-y', '-i', inputPath, '-vf', `fps=${fps},scale=${maxWidth}:-2`, outputPattern] };
}

export function planAnchorFrameExtraction(inputPath: string, outputPath: string, timestampSec: number, maxWidth = 720): FfmpegCommandPlan {
  return { description: 'Extract a single creator-selected anchor frame.', requiresExecutionHook: 'run_ffmpeg', outputPath, args: ['-y', '-ss', String(Math.max(0, timestampSec)), '-i', inputPath, '-frames:v', '1', '-vf', `scale=${maxWidth}:-2`, outputPath] };
}

export function planCandidateFrameExtraction(inputPath: string, outputPattern: string, startSec: number, durationSec: number, fps = 12): FfmpegCommandPlan {
  return { description: 'Extract denser candidate frames into a cache/lab directory.', requiresExecutionHook: 'run_ffmpeg', outputPath: outputPattern, args: ['-y', '-ss', String(Math.max(0, startSec)), '-t', String(Math.max(0.1, durationSec)), '-i', inputPath, '-vf', `fps=${fps},scale=360:-2`, outputPattern] };
}
