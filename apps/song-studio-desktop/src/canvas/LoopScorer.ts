import type { ExtractedFrame, LoopAnchor, LoopScore } from './types';

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
const continuity = (delta: number, scale: number) => clamp01(1 - Math.abs(delta) / scale);

export function scoreLoop(anchorFrame: ExtractedFrame, endFrame: ExtractedFrame, anchor: LoopAnchor, minDurationSec = 3, maxDurationSec = 8): LoopScore {
  const loopDuration = Math.max(0, endFrame.timestampSec - anchor.timestampSec);
  const am = anchorFrame.metrics ?? {};
  const em = endFrame.metrics ?? {};
  const visualSimilarity = clamp01(em.visualSimilarity ?? 0.5);
  const brightnessContinuity = am.brightness !== undefined && em.brightness !== undefined ? continuity(em.brightness - am.brightness, 1) : 0.5;
  const colorContinuity = am.colorVector && em.colorVector ? continuity(Math.hypot(em.colorVector[0] - am.colorVector[0], em.colorVector[1] - am.colorVector[1], em.colorVector[2] - am.colorVector[2]), 441.7) : 0.5;
  const motionContinuity = am.motionMagnitude !== undefined && em.motionMagnitude !== undefined ? continuity(em.motionMagnitude - am.motionMagnitude, 1) : 0.5;
  const mid = (minDurationSec + maxDurationSec) / 2;
  const span = (maxDurationSec - minDurationSec) / 2;
  const durationFit = loopDuration >= minDurationSec && loopDuration <= maxDurationSec ? continuity(loopDuration - mid, Math.max(span, 0.1)) : 0;
  const jumpRisk = clamp01(1 - (visualSimilarity * 0.45 + brightnessContinuity * 0.2 + colorContinuity * 0.2 + motionContinuity * 0.15));
  const overall = clamp01(visualSimilarity * 0.35 + brightnessContinuity * 0.15 + colorContinuity * 0.15 + motionContinuity * 0.1 + durationFit * 0.2 + (1 - jumpRisk) * 0.05);
  const reasons = [`duration ${loopDuration.toFixed(2)}s`, `visual ${(visualSimilarity * 100).toFixed(0)}%`, `jump risk ${(jumpRisk * 100).toFixed(0)}%`];
  return { visualSimilarity, brightnessContinuity, colorContinuity, motionContinuity, durationFit, jumpRisk, overall, reasons };
}
