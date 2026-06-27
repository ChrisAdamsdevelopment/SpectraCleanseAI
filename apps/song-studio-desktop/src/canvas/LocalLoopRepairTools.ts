import type { FfmpegCommandPlan, LoopExportRequest } from './types';

const canvasScale = (width = 1080, height = 1920) => `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;

export function planHardCutExport(request: LoopExportRequest): FfmpegCommandPlan {
  const duration = request.candidate.loopDurationSec;
  return { description: 'Trim directly from anchor to candidate end with no seam repair.', requiresExecutionHook: 'run_ffmpeg', outputPath: request.outputPath, args: ['-y', '-ss', String(request.anchor.timestampSec), '-t', String(duration), '-i', request.inputPath, '-vf', `${canvasScale(request.targetWidth, request.targetHeight)},fps=${request.targetFps ?? 30}`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', request.outputPath] };
}

export function planCrossfadeExport(request: LoopExportRequest): FfmpegCommandPlan {
  const duration = request.candidate.loopDurationSec;
  const fade = Math.min(request.crossfadeSec ?? 0.25, Math.max(0.05, duration / 4));
  return { description: 'Plan a local crossfade loop export. Execution will use the existing run_ffmpeg hook.', requiresExecutionHook: 'run_ffmpeg', outputPath: request.outputPath, args: ['-y', '-ss', String(request.anchor.timestampSec), '-t', String(duration), '-i', request.inputPath, '-filter_complex', `[0:v]${canvasScale(request.targetWidth, request.targetHeight)},fps=${request.targetFps ?? 30},split=2[a][b];[a]trim=0:${duration},setpts=PTS-STARTPTS[first];[b]trim=0:${fade},setpts=PTS-STARTPTS[loop];[first][loop]xfade=transition=fade:duration=${fade}:offset=${Math.max(0, duration - fade)}[v]`, '-map', '[v]', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', request.outputPath] };
}

export function planPingPongExport(request: LoopExportRequest): FfmpegCommandPlan {
  const duration = request.candidate.loopDurationSec;
  return { description: 'Plan a ping-pong fallback export by appending a reversed copy.', requiresExecutionHook: 'run_ffmpeg', outputPath: request.outputPath, args: ['-y', '-ss', String(request.anchor.timestampSec), '-t', String(duration), '-i', request.inputPath, '-filter_complex', `[0:v]${canvasScale(request.targetWidth, request.targetHeight)},fps=${request.targetFps ?? 30},split[fwd][revsrc];[revsrc]reverse[rev];[fwd][rev]concat=n=2:v=1:a=0[v]`, '-map', '[v]', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', request.outputPath] };
}

export function planFrameBlendExport(request: LoopExportRequest): FfmpegCommandPlan {
  return { ...planCrossfadeExport({ ...request, crossfadeSec: request.crossfadeSec ?? 0.12 }), description: 'Plan a short frame-blend style seam repair using crossfade primitives.' };
}
