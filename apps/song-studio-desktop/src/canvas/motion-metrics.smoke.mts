import { calculateSeamMotionContinuity, calculateTemporalMotionMetrics, hasRealMotionMetric } from './MotionMetrics.ts';
import type { ReadFrameMetricsResult } from './FrameMetrics.ts';
import type { ExtractedFrame, FrameMetrics } from './types.ts';

const EPSILON = 1e-9;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requireNumber(value: number | undefined, label: string): number {
  assert(value !== undefined, `${label} should be defined`);
  return value;
}

function assertNear(actual: number | undefined, expected: number, tolerance: number, message: string): void {
  const actualValue = requireNumber(actual, message);
  assert(Math.abs(actualValue - expected) <= tolerance, `${message}: expected ${expected} ± ${tolerance}, received ${actualValue}`);
}

function assertFiniteUnitInterval(value: number | undefined, label: string): void {
  const actualValue = requireNumber(value, label);
  assert(Number.isFinite(actualValue), `${label} should be finite`);
  assert(actualValue >= 0 && actualValue <= 1, `${label} should be clamped between 0 and 1, received ${actualValue}`);
}

function frameSample(metrics: FrameMetrics, fingerprint: number[]): ReadFrameMetricsResult {
  return { metrics, fingerprint, width: 16, height: 16 };
}

function assertTemporalMetricsAreBounded(metrics: ReturnType<typeof calculateTemporalMotionMetrics>, label: string): void {
  assertFiniteUnitInterval(metrics.motionMagnitude, `${label} motionMagnitude`);
  assertFiniteUnitInterval(metrics.temporalSimilarity, `${label} temporalSimilarity`);
  assertFiniteUnitInterval(metrics.motionDelta, `${label} motionDelta`);
}

function runTemporalMotionMetricTests(): void {
  const base = frameSample(
    { brightness: 0.4, colorVector: [100, 120, 140] },
    [0.1, 0.2, 0.3, 0.4],
  );
  const identical = frameSample(
    { brightness: 0.4, colorVector: [100, 120, 140] },
    [0.1, 0.2, 0.3, 0.4],
  );
  const smallChange = frameSample(
    { brightness: 0.43, colorVector: [103, 122, 141] },
    [0.12, 0.21, 0.32, 0.39],
  );
  const largeChange = frameSample(
    { brightness: 1, colorVector: [240, 20, 30] },
    [0.95, 0.85, 0.05, 0.0],
  );
  const extremeChange = frameSample(
    { brightness: 42, colorVector: [999, -999, Number.POSITIVE_INFINITY] },
    [Number.POSITIVE_INFINITY, -100, Number.NaN, 100],
  );

  const identicalMetrics = calculateTemporalMotionMetrics(base, identical);
  const smallChangeMetrics = calculateTemporalMotionMetrics(base, smallChange);
  const largeChangeMetrics = calculateTemporalMotionMetrics(base, largeChange);
  const extremeMetrics = calculateTemporalMotionMetrics(base, extremeChange);

  assertTemporalMetricsAreBounded(identicalMetrics, 'identical');
  assertNear(identicalMetrics.motionMagnitude, 0, EPSILON, 'Identical frames should have near-zero motionMagnitude');
  assertNear(identicalMetrics.temporalSimilarity, 1, EPSILON, 'Identical frames should have near-one temporalSimilarity');
  assertNear(identicalMetrics.motionDelta, 0, EPSILON, 'Identical frames should have near-zero motionDelta');

  assertTemporalMetricsAreBounded(smallChangeMetrics, 'small change');
  const identicalMotionMagnitude = requireNumber(identicalMetrics.motionMagnitude, 'identical motionMagnitude');
  const smallMotionMagnitude = requireNumber(smallChangeMetrics.motionMagnitude, 'small change motionMagnitude');
  const smallTemporalSimilarity = requireNumber(smallChangeMetrics.temporalSimilarity, 'small change temporalSimilarity');
  assert(smallMotionMagnitude > identicalMotionMagnitude, 'Small changes should increase motionMagnitude over identical frames');
  assert(smallMotionMagnitude < 0.2, `Small changes should remain low/moderate, received ${smallMotionMagnitude}`);
  assert(smallTemporalSimilarity < 1, 'Small changes should reduce temporalSimilarity below 1');
  assert(smallTemporalSimilarity > 0.8, `Small changes should keep temporalSimilarity high, received ${smallTemporalSimilarity}`);

  assertTemporalMetricsAreBounded(largeChangeMetrics, 'large change');
  const largeMotionMagnitude = requireNumber(largeChangeMetrics.motionMagnitude, 'large change motionMagnitude');
  const largeTemporalSimilarity = requireNumber(largeChangeMetrics.temporalSimilarity, 'large change temporalSimilarity');
  assert(largeMotionMagnitude > smallMotionMagnitude, 'Large changes should have greater motionMagnitude than small changes');
  assert(largeTemporalSimilarity < smallTemporalSimilarity, 'Large changes should have lower temporalSimilarity than small changes');

  assertTemporalMetricsAreBounded(extremeMetrics, 'extreme change');
}

function runSeamMotionContinuityTests(): void {
  const matching = calculateSeamMotionContinuity({ motionMagnitude: 0.35 }, { motionMagnitude: 0.35 });
  const different = calculateSeamMotionContinuity({ motionMagnitude: 0.1 }, { motionMagnitude: 0.8 });

  assertNear(matching, 1, EPSILON, 'Matching motion magnitudes should have near-one continuity');
  assertFiniteUnitInterval(different, 'Different motion continuity');
  assert(different !== undefined && matching !== undefined && different < matching, 'Different motion magnitudes should reduce continuity');
  assert(calculateSeamMotionContinuity(undefined, { motionMagnitude: 0.2 }) === undefined, 'Missing anchor motion should return undefined');
  assert(calculateSeamMotionContinuity({ motionMagnitude: 0.2 }, undefined) === undefined, 'Missing candidate motion should return undefined');
  assert(calculateSeamMotionContinuity({}, { motionMagnitude: 0.2 }) === undefined, 'Missing anchor motionMagnitude should return undefined');
  assert(calculateSeamMotionContinuity({ motionMagnitude: 0.2 }, {}) === undefined, 'Missing candidate motionMagnitude should return undefined');
}

function runRealMotionMetricTests(): void {
  const realMotionFrame: ExtractedFrame = { sourceId: 'fixture', timestampSec: 0, frameIndex: 0, metrics: { motionMagnitude: 0.42, motionMetricSource: 'adjacent-frame-delta' } };
  const placeholderFrame: ExtractedFrame = { sourceId: 'fixture', timestampSec: 0, frameIndex: 1, metrics: { motionMagnitude: 0.42, motionMetricSource: 'placeholder' } };
  const missingMetricsFrame: ExtractedFrame = { sourceId: 'fixture', timestampSec: 0, frameIndex: 2 };
  const nonFiniteMotionFrame: ExtractedFrame = { sourceId: 'fixture', timestampSec: 0, frameIndex: 3, metrics: { motionMagnitude: Number.NaN, motionMetricSource: 'adjacent-frame-delta' } };

  assert(hasRealMotionMetric(realMotionFrame), 'Adjacent-frame-delta motion should be treated as real');
  assert(!hasRealMotionMetric(placeholderFrame), 'Placeholder motion should not be treated as real');
  assert(!hasRealMotionMetric(missingMetricsFrame), 'Missing metrics should not be treated as real motion');
  assert(!hasRealMotionMetric(nonFiniteMotionFrame), 'Non-finite adjacent-frame motion should not be treated as real');
}

runTemporalMotionMetricTests();
runSeamMotionContinuityTests();
runRealMotionMetricTests();

console.log(JSON.stringify({ mode: 'motion-metrics', ok: true, ffmpegUsed: false, generatedMedia: false, apiCallsMade: false }, null, 2));
