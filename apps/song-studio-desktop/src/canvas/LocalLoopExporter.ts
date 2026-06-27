import type { LoopExportRequest, LoopExportResult } from './types';
import { planCrossfadeExport, planFrameBlendExport, planHardCutExport, planPingPongExport } from './LocalLoopRepairTools';

export function planLocalLoopExport(request: LoopExportRequest): LoopExportResult {
  const plan = request.method === 'hard-cut' ? planHardCutExport(request)
    : request.method === 'crossfade' ? planCrossfadeExport(request)
    : request.method === 'ping-pong' ? planPingPongExport(request)
    : planFrameBlendExport(request);
  return { ok: true, request, plan, outputPath: request.outputPath, warnings: ['Command planning only; execution must go through the existing run_ffmpeg Tauri hook.'] };
}
