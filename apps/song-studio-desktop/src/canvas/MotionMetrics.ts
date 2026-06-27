import type { ExtractedFrame, FrameMetrics } from './types';
import type { ReadFrameMetricsResult } from './FrameMetrics';

const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

function colorDelta(a?: [number, number, number], b?: [number, number, number]): number {
  if (!a || !b) return 0;
  return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / Math.sqrt(3 * 255 * 255);
}

function fingerprintDelta(previous: number[], current: number[]): number {
  const samples = Math.min(previous.length, current.length);
  if (samples <= 0) return 0;
  let total = 0;
  for (let i = 0; i < samples; i += 1) {
    total += Math.abs((current[i] ?? 0) - (previous[i] ?? 0));
  }
  return total / samples;
}

export function calculateTemporalMotionMetrics(previous: ReadFrameMetricsResult, current: ReadFrameMetricsResult): Pick<FrameMetrics, 'motionMagnitude' | 'temporalSimilarity' | 'motionDelta'> {
  const lumaDelta = Math.abs((current.metrics.brightness ?? 0) - (previous.metrics.brightness ?? 0));
  const color = colorDelta(previous.metrics.colorVector, current.metrics.colorVector);
  const fingerprint = fingerprintDelta(previous.fingerprint, current.fingerprint);
  const motionMagnitude = clamp01(fingerprint * 0.7 + lumaDelta * 0.2 + color * 0.1);
  return {
    motionMagnitude,
    temporalSimilarity: clamp01(1 - motionMagnitude),
    motionDelta: motionMagnitude,
  };
}

export function calculateSeamMotionContinuity(anchorMetrics?: FrameMetrics, candidateMetrics?: FrameMetrics): number | undefined {
  if (anchorMetrics?.motionMagnitude === undefined || candidateMetrics?.motionMagnitude === undefined) return undefined;
  return clamp01(1 - Math.abs(candidateMetrics.motionMagnitude - anchorMetrics.motionMagnitude));
}

export function hasRealMotionMetric(frame: ExtractedFrame): boolean {
  return frame.metrics?.motionMagnitude !== undefined && Number.isFinite(frame.metrics.motionMagnitude) && frame.metrics.motionMetricSource === 'adjacent-frame-delta';
}
