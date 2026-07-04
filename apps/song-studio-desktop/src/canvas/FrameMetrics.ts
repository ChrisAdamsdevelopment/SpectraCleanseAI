import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveCanvasHarnessFfmpeg } from './CanvasFfmpegRunner';
import type { ExtractedFrame, FrameMetrics } from './types';
import { calculateTemporalMotionMetrics } from './MotionMetrics';

const execFileAsync = promisify(execFile);
const SAMPLE_WIDTH = 16;
const SAMPLE_HEIGHT = 16;
const CHANNELS = 3;
const EXPECTED_BYTES = SAMPLE_WIDTH * SAMPLE_HEIGHT * CHANNELS;

export interface ReadFrameMetricsResult {
  metrics: FrameMetrics;
  fingerprint: number[];
  width: number;
  height: number;
}

export interface FrameMetricsAttachmentResult {
  frames: ExtractedFrame[];
  warnings: string[];
  realMetricsUsed: boolean;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function readDownscaledRgb(framePath: string): Promise<Buffer> {
  const ffmpeg = resolveCanvasHarnessFfmpeg();
  const { stdout } = await execFileAsync(
    ffmpeg,
    ['-v', 'error', '-i', framePath, '-vf', `scale=${SAMPLE_WIDTH}:${SAMPLE_HEIGHT}:flags=area,format=rgb24`, '-frames:v', '1', '-f', 'rawvideo', '-'],
    { encoding: 'buffer', maxBuffer: EXPECTED_BYTES * 4 },
  );
  const bytes = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  if (bytes.length < EXPECTED_BYTES) throw new Error(`expected ${EXPECTED_BYTES} RGB bytes, received ${bytes.length}`);
  return bytes.subarray(0, EXPECTED_BYTES);
}

/**
 * Reads a still frame locally through the harness FFmpeg binary and summarizes a
 * tiny 16x16 RGB sample. This deliberately avoids GPU work, cloud uploads, and
 * heavyweight image libraries; it is a first-pass perceptual signal, not optical
 * flow or full seam repair analysis.
 */
export async function readFrameMetrics(framePath: string): Promise<ReadFrameMetricsResult> {
  const bytes = await readDownscaledRgb(framePath);
  let totalLuma = 0;
  let totalR = 0;
  let totalG = 0;
  let totalB = 0;
  const fingerprint: number[] = [];

  for (let i = 0; i < EXPECTED_BYTES; i += CHANNELS) {
    const r = bytes[i] ?? 0;
    const g = bytes[i + 1] ?? 0;
    const b = bytes[i + 2] ?? 0;
    const pixelLuma = luma(r, g, b);
    totalR += r;
    totalG += g;
    totalB += b;
    totalLuma += pixelLuma;
    fingerprint.push(pixelLuma / 255);
  }

  const pixels = SAMPLE_WIDTH * SAMPLE_HEIGHT;
  return {
    metrics: {
      brightness: clamp01(totalLuma / pixels / 255),
      colorVector: [Math.round(totalR / pixels), Math.round(totalG / pixels), Math.round(totalB / pixels)],
      motionMagnitude: 0.2,
      motionMetricSource: 'placeholder',
    },
    fingerprint,
    width: SAMPLE_WIDTH,
    height: SAMPLE_HEIGHT,
  };
}

export function compareFrameMetricSamples(anchor: ReadFrameMetricsResult, candidate: ReadFrameMetricsResult): number {
  const anchorColor = anchor.metrics.colorVector ?? [0, 0, 0];
  const candidateColor = candidate.metrics.colorVector ?? [0, 0, 0];
  const brightnessSimilarity = 1 - Math.abs((candidate.metrics.brightness ?? 0) - (anchor.metrics.brightness ?? 0));
  const colorDistance = Math.hypot(candidateColor[0] - anchorColor[0], candidateColor[1] - anchorColor[1], candidateColor[2] - anchorColor[2]);
  const colorSimilarity = 1 - colorDistance / Math.sqrt(3 * 255 * 255);

  const samples = Math.min(anchor.fingerprint.length, candidate.fingerprint.length);
  let mse = 0;
  for (let i = 0; i < samples; i += 1) {
    const delta = (candidate.fingerprint[i] ?? 0) - (anchor.fingerprint[i] ?? 0);
    mse += delta * delta;
  }
  const gridSimilarity = samples > 0 ? 1 - Math.sqrt(mse / samples) : 0.5;
  return clamp01(brightnessSimilarity * 0.25 + colorSimilarity * 0.25 + gridSimilarity * 0.5);
}

export async function compareFrameMetrics(anchorPath: string, candidatePath: string): Promise<FrameMetrics> {
  const anchor = await readFrameMetrics(anchorPath);
  const candidate = await readFrameMetrics(candidatePath);
  return { ...candidate.metrics, visualSimilarity: compareFrameMetricSamples(anchor, candidate) };
}

export async function attachFrameMetrics(frames: ExtractedFrame[], anchorFrame?: ExtractedFrame): Promise<FrameMetricsAttachmentResult> {
  const warnings: string[] = [];
  const samples = new Map<string, ReadFrameMetricsResult>();
  let realMetricsUsed = false;

  const readSample = async (frame: ExtractedFrame): Promise<ReadFrameMetricsResult | undefined> => {
    if (!frame.framePath) return undefined;
    if (samples.has(frame.framePath)) return samples.get(frame.framePath);
    try {
      const sample = await readFrameMetrics(frame.framePath);
      samples.set(frame.framePath, sample);
      realMetricsUsed = true;
      return sample;
    } catch (err) {
      warnings.push(`Frame metric extraction failed for ${frame.framePath}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  };

  const anchorSample = anchorFrame ? await readSample(anchorFrame) : undefined;
  const updatedFrames: ExtractedFrame[] = [];
  let previousSample: ReadFrameMetricsResult | undefined;

  const orderedFrames = [...frames].sort((a, b) => a.timestampSec - b.timestampSec || a.frameIndex - b.frameIndex);
  const motionByFramePath = new Map<string, Pick<FrameMetrics, 'motionMagnitude' | 'temporalSimilarity' | 'motionDelta' | 'motionMetricSource'>>();
  for (const frame of orderedFrames) {
    const sample = await readSample(frame);
    if (sample && previousSample && frame.framePath) {
      motionByFramePath.set(frame.framePath, { ...calculateTemporalMotionMetrics(previousSample, sample), motionMetricSource: 'adjacent-frame-delta' });
    }
    if (sample) previousSample = sample;
  }
  if (orderedFrames.length > 1 && motionByFramePath.size === 0) warnings.push('Motion metrics fallback used because adjacent frame samples were unavailable.');

  for (const frame of frames) {
    const sample = await readSample(frame);
    if (!sample) {
      updatedFrames.push(frame);
      continue;
    }
    const visualSimilarity = anchorSample ? compareFrameMetricSamples(anchorSample, sample) : frame.metrics?.visualSimilarity;
    const motionMetrics = frame.framePath ? motionByFramePath.get(frame.framePath) : undefined;
    updatedFrames.push({ ...frame, metrics: { ...frame.metrics, ...sample.metrics, ...motionMetrics, visualSimilarity } });
  }

  return { frames: updatedFrames, warnings, realMetricsUsed };
}
