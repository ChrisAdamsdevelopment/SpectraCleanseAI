import { writeFileSync } from 'node:fs';
import { createCanvasWorkspace, canvasWorkspacePath, type CanvasWorkspacePaths } from './CanvasWorkspace';
import { runCanvasFfmpegPlan, generateCanvasFixtureVideo, probeVideoSpec } from './CanvasFfmpegRunner';
import { extractAnchorFrameForHarness, extractCandidateFramesForHarness } from './FrameExtractor';
import { validateCanvasVideoSpec } from './VideoSpecValidator';
import { createLoopAnchor } from './AnchorSelector';
import { findLoopCandidates } from './LoopCandidateFinder';
import { planLocalLoopExport } from './LocalLoopExporter';
import { generateCanvasLoopReport } from './ReportGenerator';
import { summarizeLoopReadiness, type LoopReadinessSummary } from './LoopReadiness';
import { MockAIProvider } from './providers/MockAIProvider';
import { CANVAS_LAB_METHODS, type CanvasLabControls, type CanvasLoopLabMode } from './CanvasLabControls';
import type { CanvasLoopReport, CanvasVideoSpec, ExtractedFrame, LoopAnchor, LoopCandidate, LoopRepairMethod } from './types';

// Harness-only end-to-end Canvas Loop "lab" runner. It is the local operator/
// evaluation surface for the engine: drive it with CanvasLabControls (real input
// video, anchor, duration window, method, compare-methods, output dir) and it
// validates -> extracts real frames/metrics -> ranks -> summarizes readiness ->
// PLANS and EXECUTES local loop exports -> writes a structured JSON report.
//
// Production rendering still goes through the Tauri run_ffmpeg command. This path
// never makes a network/AI/cloud/paid call and never commits generated media.

export type { CanvasLabControls, CanvasLoopLabMode } from './CanvasLabControls';

export interface CanvasLabMethodResult {
  method: LoopRepairMethod;
  planned: boolean;
  executed: boolean;
  ok: boolean;
  plannedArgsCount: number;
  outputPath?: string;
  bytes?: number;
  durationMs?: number;
  stderrTail?: string;
}

export interface CanvasLabInputSource {
  type: 'generated-fixture' | 'real-input';
  inputPath: string;
  userSupplied: boolean;
  fileSizeBytes?: number;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
}

export interface CanvasLabSafetyFlags {
  aiUsed: false;
  apiCallsMade: false;
  networkCalls: false;
  cloudUploads: false;
  paidCalls: false;
  generatedMediaCommitted: false;
  providerId: string;
}

export interface CanvasLoopLabReport {
  mode: CanvasLoopLabMode;
  generatedAt: string;
  engineVersion: string;
  controls: CanvasLabControls;
  inputSource: CanvasLabInputSource;
  validationOk: boolean;
  validationErrors: string[];
  validationWarnings: string[];
  anchorTimeSec: number;
  candidateCount: number;
  bestCandidate?: { timestampSec: number; loopDurationSec: number; rank: number };
  loopScore?: CanvasLoopReport['score'];
  readiness?: LoopReadinessSummary;
  selectedMethod: LoopRepairMethod;
  autoRecommendedMethod: LoopRepairMethod;
  export: CanvasLabMethodResult;
  methodComparison?: CanvasLabMethodResult[];
  report: CanvasLoopReport;
  workspacePath: string;
  outputDirUserSupplied: boolean;
  reportPath?: string;
  realMetricsUsed?: boolean;
  metricWarnings?: string[];
  warnings: string[];
  safety: CanvasLabSafetyFlags;
}

const ENGINE_VERSION = 'canvas-loop-local-mvp-0.1';

function assertNoAiCalls(): string {
  const mock = new MockAIProvider();
  if (mock.calls.length !== 0) throw new Error('Canvas lab must not call any AI provider method');
  return mock.getProviderCapabilities().providerId;
}

function safetyFlags(providerId: string): CanvasLabSafetyFlags {
  return { aiUsed: false, apiCallsMade: false, networkCalls: false, cloudUploads: false, paidCalls: false, generatedMediaCommitted: false, providerId };
}

function resolveMethod(choice: CanvasLabControls['method'], recommended: LoopRepairMethod): LoopRepairMethod {
  return !choice || choice === 'auto' ? recommended : choice;
}

/** Plan (and optionally execute) one repair method into its own output file. */
async function runOneMethod(method: LoopRepairMethod, inputPath: string, outputPath: string, anchor: LoopAnchor, candidate: LoopCandidate, execute: boolean): Promise<CanvasLabMethodResult> {
  const exportResult = planLocalLoopExport({ inputPath, outputPath, anchor, candidate, method });
  if (!execute) return { method, planned: true, executed: false, ok: true, plannedArgsCount: exportResult.plan.args.length, outputPath };
  const run = await runCanvasFfmpegPlan(exportResult.plan);
  const ok = run.ok && Boolean(run.bytes && run.bytes > 0);
  return { method, planned: true, executed: true, ok, plannedArgsCount: exportResult.plan.args.length, outputPath: ok ? run.outputPath : undefined, bytes: run.bytes, durationMs: run.durationMs, stderrTail: run.stderrTail };
}

function syntheticFrames(): { anchorFrame: ExtractedFrame; frames: ExtractedFrame[] } {
  const anchorFrame: ExtractedFrame = { sourceId: 'lab-fixture', timestampSec: 0, frameIndex: 0, metrics: { brightness: 0.5, colorVector: [120, 80, 200], motionMagnitude: 0.2 } };
  const frames: ExtractedFrame[] = [
    { sourceId: 'lab-fixture', timestampSec: 3.2, frameIndex: 96, metrics: { visualSimilarity: 0.82, brightness: 0.53, colorVector: [124, 78, 198], motionMagnitude: 0.25 } },
    { sourceId: 'lab-fixture', timestampSec: 5.8, frameIndex: 174, metrics: { visualSimilarity: 0.62, brightness: 0.7, colorVector: [180, 90, 210], motionMagnitude: 0.7 } },
  ];
  return { anchorFrame, frames };
}

/** Logic-only slice: synthetic frames -> validate -> anchor -> rank -> readiness -> PLAN export(s) (no execution). */
function runLogicOnlyLab(controls: CanvasLabControls, providerId: string): CanvasLoopLabReport {
  const spec: CanvasVideoSpec = { filePath: '/tmp/song-studio-canvas-fixture.mp4', fileType: 'mp4', durationSec: 6, width: 1080, height: 1920, fps: 30, codec: 'h264' };
  const validation = validateCanvasVideoSpec(spec);
  const anchorTimeSec = Math.max(0, controls.anchorTimeSec ?? 0);
  const anchor = createLoopAnchor({ sourceId: 'lab-fixture', sourceFilePath: spec.filePath, timestampSec: anchorTimeSec, fps: spec.fps, notes: 'canvas lab logic-only fixture' });
  const { anchorFrame, frames } = syntheticFrames();
  const candidates = findLoopCandidates(anchor, anchorFrame, frames, finderOptions(controls));
  const [candidate] = candidates;
  if (!candidate) throw new Error('Canvas lab (logic-only) expected at least one loop candidate');

  const readiness = summarizeLoopReadiness(candidate, validation);
  const autoRecommendedMethod = readiness.recommendedMethod;
  const selectedMethod = resolveMethod(controls.method, autoRecommendedMethod);
  const warnings: string[] = [];

  const methods = controls.compareMethods ? CANVAS_LAB_METHODS : [selectedMethod];
  const planned: CanvasLabMethodResult[] = methods.map((method) => {
    const plan = planLocalLoopExport({ inputPath: spec.filePath, outputPath: `/tmp/song-studio-canvas-loop-${method}.mp4`, anchor, candidate, method });
    return { method, planned: true, executed: false, ok: true, plannedArgsCount: plan.plan.args.length, outputPath: plan.plan.outputPath };
  });
  if (controls.compareMethods) warnings.push('compare-methods in logic-only mode plans every method; pass --ffmpeg to execute them.');
  const primary = planned.find((p) => p.method === selectedMethod) ?? planned[0];

  const exportResult = planLocalLoopExport({ inputPath: spec.filePath, outputPath: primary.outputPath ?? '/tmp/song-studio-canvas-loop.mp4', anchor, candidate, method: selectedMethod });
  const report = generateCanvasLoopReport({ inputFile: spec.filePath, validation, anchor, candidate, methodSelected: selectedMethod, exportResult, warnings });

  return {
    mode: 'logic-only', generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, controls,
    inputSource: { type: 'generated-fixture', inputPath: spec.filePath, userSupplied: false, durationSec: spec.durationSec, width: spec.width, height: spec.height, fps: spec.fps },
    validationOk: validation.ok, validationErrors: validation.errors.map((e) => e.message), validationWarnings: validation.warnings.map((w) => w.message),
    anchorTimeSec, candidateCount: candidates.length,
    bestCandidate: { timestampSec: candidate.endFrame.timestampSec, loopDurationSec: candidate.loopDurationSec, rank: candidate.rank },
    loopScore: candidate.score, readiness, selectedMethod, autoRecommendedMethod,
    export: primary, methodComparison: controls.compareMethods ? planned : undefined,
    report, workspacePath: '(logic-only: no workspace)', outputDirUserSupplied: false,
    warnings, safety: safetyFlags(providerId),
  };
}

function finderOptions(controls: CanvasLabControls) {
  return {
    minDurationSec: controls.minDurationSec ?? 3,
    maxDurationSec: controls.maxDurationSec ?? 8,
    topN: controls.topN ?? 5,
    minSimilarityScore: controls.minSimilarityScore ?? 0.45,
  };
}

/** Full slice: fixture or real input -> extract real frames/metrics -> rank -> readiness -> PLAN + EXECUTE export(s) -> verify MP4(s). */
async function runFfmpegLab(controls: CanvasLabControls, providerId: string): Promise<CanvasLoopLabReport> {
  const workspace: CanvasWorkspacePaths = createCanvasWorkspace({ baseDir: controls.outputDir, prefix: 'song-studio-canvas-lab-' });
  const outputDirUserSupplied = Boolean(controls.outputDir);
  const warnings: string[] = [];

  // Resolve the source: a real local input clip, or the generated fixture fallback.
  let inputVideoPath: string;
  let spec: CanvasVideoSpec;
  let inputSourceType: CanvasLabInputSource['type'];
  if (controls.inputPath) {
    const probe = await probeVideoSpec(controls.inputPath);
    if (!probe.ok || !probe.spec) throw new Error(`Could not read input video "${controls.inputPath}": ${probe.stderrTail ?? 'unknown probe error'}`);
    inputVideoPath = controls.inputPath;
    spec = probe.spec;
    inputSourceType = 'real-input';
  } else {
    const durationSec = controls.fixtureDurationSec ?? 6;
    inputVideoPath = canvasWorkspacePath(workspace, 'source', 'canvas-fixture.mp4');
    const fixture = await generateCanvasFixtureVideo(inputVideoPath, durationSec);
    if (!fixture.ok) throw new Error(`Canvas lab fixture generation failed: ${fixture.stderrTail ?? 'unknown FFmpeg error'}`);
    spec = { filePath: inputVideoPath, fileType: 'mp4', durationSec, width: 180, height: 320, fps: 12, codec: 'h264', fileSizeBytes: fixture.bytes };
    inputSourceType = 'generated-fixture';
  }

  const validation = validateCanvasVideoSpec(spec);
  if (!validation.ok) {
    const messages = validation.errors.map((e) => e.message).join('; ');
    if (inputSourceType === 'generated-fixture') throw new Error(`Canvas lab fixture validation failed: ${messages}`);
    warnings.push(`Input did not pass Canvas validation: ${messages}`);
  }

  const minDurationSec = controls.minDurationSec ?? 3;
  const maxDurationSec = controls.maxDurationSec ?? 8;
  const anchorTimeSec = Math.min(Math.max(0, controls.anchorTimeSec ?? 0), Math.max(0, spec.durationSec - 0.1));
  const windowDurationSec = Math.max(0.5, Math.min(maxDurationSec, spec.durationSec - anchorTimeSec));
  if (spec.durationSec - anchorTimeSec < minDurationSec) {
    throw new Error(`Not enough video after the anchor (${(spec.durationSec - anchorTimeSec).toFixed(2)}s) for a ${minDurationSec}s minimum loop.`);
  }

  const anchor = createLoopAnchor({ sourceId: 'lab-input', sourceFilePath: inputVideoPath, timestampSec: anchorTimeSec, fps: spec.fps, notes: `${inputSourceType} anchor` });
  const anchorMaxWidth = Math.min(360, Math.max(120, spec.width));
  const anchorExtraction = await extractAnchorFrameForHarness(inputVideoPath, canvasWorkspacePath(workspace, 'anchor', 'anchor-0001.png'), anchor.timestampSec, { sourceId: 'lab-input', fps: spec.fps, maxWidth: anchorMaxWidth });
  const candidateExtraction = await extractCandidateFramesForHarness(inputVideoPath, canvasWorkspacePath(workspace, 'candidatePattern', 'candidate-%04d.png'), anchorTimeSec, windowDurationSec, { sourceId: 'lab-input', fps: 2, maxWidth: anchorMaxWidth, anchorFrame: anchorExtraction.frame });

  // Carry a real adjacent-frame motion sample onto the anchor so motion continuity is meaningful.
  const motionFrame = candidateExtraction.frames.find((f) => f.metrics?.motionMetricSource === 'adjacent-frame-delta') ?? candidateExtraction.frames[0];
  const scoringAnchorFrame: ExtractedFrame = motionFrame?.metrics
    ? { ...anchorExtraction.frame, metrics: { ...anchorExtraction.frame.metrics, motionMagnitude: motionFrame.metrics.motionMagnitude, temporalSimilarity: motionFrame.metrics.temporalSimilarity, motionDelta: motionFrame.metrics.motionDelta, motionMetricSource: motionFrame.metrics.motionMetricSource } }
    : anchorExtraction.frame;

  const candidates = findLoopCandidates(anchor, scoringAnchorFrame, candidateExtraction.frames, finderOptions(controls));
  const [candidate] = candidates;
  if (!candidate) throw new Error('Canvas lab found no loop candidate in the requested duration window. Try a different anchor or widen --min/--max-duration.');

  const readiness = summarizeLoopReadiness(candidate, validation);
  const autoRecommendedMethod = readiness.recommendedMethod;
  const selectedMethod = resolveMethod(controls.method, autoRecommendedMethod);
  const outputFor = (method: LoopRepairMethod) => canvasWorkspacePath(workspace, 'export', `canvas-loop-${method}.mp4`);

  let methodComparison: CanvasLabMethodResult[] | undefined;
  let primary: CanvasLabMethodResult;
  if (controls.compareMethods) {
    methodComparison = [];
    for (const method of CANVAS_LAB_METHODS) {
      methodComparison.push(await runOneMethod(method, inputVideoPath, outputFor(method), anchor, candidate, true));
    }
    primary = methodComparison.find((r) => r.method === selectedMethod) ?? methodComparison[0];
    if (!methodComparison.some((r) => r.ok)) warnings.push('Every local repair method failed to produce an MP4.');
    for (const failed of methodComparison.filter((r) => !r.ok)) warnings.push(`Method ${failed.method} did not produce a valid MP4.`);
  } else {
    primary = await runOneMethod(selectedMethod, inputVideoPath, outputFor(selectedMethod), anchor, candidate, true);
    if (!primary.ok) warnings.push(`Local ${selectedMethod} export did not produce a valid MP4.`);
  }

  const metricWarnings = [...anchorExtraction.metricWarnings, ...candidateExtraction.metricWarnings];
  const exportResult = planLocalLoopExport({ inputPath: inputVideoPath, outputPath: primary.outputPath ?? outputFor(selectedMethod), anchor, candidate, method: selectedMethod });
  const report = generateCanvasLoopReport({ inputFile: inputVideoPath, validation, anchor, candidate, methodSelected: selectedMethod, exportResult: { ...exportResult, outputPath: primary.ok ? primary.outputPath : undefined }, warnings: [...metricWarnings, ...warnings] });

  const labReport: CanvasLoopLabReport = {
    mode: 'ffmpeg', generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION, controls,
    inputSource: { type: inputSourceType, inputPath: inputVideoPath, userSupplied: inputSourceType === 'real-input', fileSizeBytes: spec.fileSizeBytes, durationSec: spec.durationSec, width: spec.width, height: spec.height, fps: spec.fps },
    validationOk: validation.ok, validationErrors: validation.errors.map((e) => e.message), validationWarnings: validation.warnings.map((w) => w.message),
    anchorTimeSec, candidateCount: candidates.length,
    bestCandidate: { timestampSec: candidate.endFrame.timestampSec, loopDurationSec: candidate.loopDurationSec, rank: candidate.rank },
    loopScore: candidate.score, readiness, selectedMethod, autoRecommendedMethod,
    export: primary, methodComparison, report,
    workspacePath: workspace.root, outputDirUserSupplied,
    realMetricsUsed: anchorExtraction.realMetricsUsed && candidateExtraction.realMetricsUsed,
    metricWarnings, warnings,
    safety: safetyFlags(providerId),
  };

  const reportPath = canvasWorkspacePath(workspace, 'report', 'canvas-lab-report.json');
  writeFileSync(reportPath, `${JSON.stringify(labReport, null, 2)}\n`);
  labReport.reportPath = reportPath;
  return labReport;
}

export async function runCanvasLoopLab(controls: CanvasLabControls = { mode: 'logic-only' }): Promise<CanvasLoopLabReport> {
  const providerId = assertNoAiCalls();
  const mode = controls.mode ?? 'logic-only';
  if (controls.inputPath && mode !== 'ffmpeg') throw new Error('A real --input video requires --ffmpeg mode (logic-only uses synthetic frames).');
  return mode === 'ffmpeg' ? runFfmpegLab(controls, providerId) : runLogicOnlyLab(controls, providerId);
}
