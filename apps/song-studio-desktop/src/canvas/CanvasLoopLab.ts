import { writeFileSync } from 'node:fs';
import { createCanvasWorkspace, canvasWorkspacePath, type CanvasWorkspacePaths } from './CanvasWorkspace';
import { runCanvasFfmpegPlan, generateCanvasFixtureVideo } from './CanvasFfmpegRunner';
import { extractAnchorFrameForHarness, extractCandidateFramesForHarness } from './FrameExtractor';
import { validateCanvasVideoSpec } from './VideoSpecValidator';
import { createLoopAnchor } from './AnchorSelector';
import { findLoopCandidates } from './LoopCandidateFinder';
import { planLocalLoopExport } from './LocalLoopExporter';
import { generateCanvasLoopReport } from './ReportGenerator';
import { summarizeLoopReadiness, type LoopReadinessSummary } from './LoopReadiness';
import { MockAIProvider } from './providers/MockAIProvider';
import type { CanvasLoopReport, CanvasVideoSpec, ExtractedFrame, LoopRepairMethod } from './types';

// Harness-only end-to-end Canvas Loop "lab" runner. Mirrors the FFmpeg smoke
// strategy (resolve ffmpeg-static / SONG_STUDIO_FFMPEG, run preplanned arg lists)
// but takes the pipeline one step further than the smoke: it ACTUALLY EXECUTES
// the planned local loop export and verifies a real looping MP4 lands in a temp
// workspace. Production rendering still goes through the Tauri run_ffmpeg command;
// this never makes a network/AI/paid call and never commits generated media.

export type CanvasLoopLabMode = 'logic-only' | 'ffmpeg';

export interface CanvasLoopLabOptions {
  mode?: CanvasLoopLabMode;
  method?: LoopRepairMethod;        // override the engine's recommended method
  fixtureDurationSec?: number;      // ffmpeg mode only
}

export interface CanvasLoopLabExport {
  method: LoopRepairMethod;
  planned: boolean;
  executed: boolean;
  ok: boolean;
  plannedArgsCount: number;
  outputPath?: string;
  bytes?: number;
  ffmpegPath?: string;
  durationMs?: number;
  stderrTail?: string;
}

export interface CanvasLoopLabReport {
  mode: CanvasLoopLabMode;
  generatedAt: string;
  engineVersion: string;
  validationOk: boolean;
  validationErrors: string[];
  validationWarnings: string[];
  anchorTimeSec: number;
  candidateCount: number;
  bestCandidate?: { timestampSec: number; loopDurationSec: number; rank: number };
  loopScore?: CanvasLoopReport['score'];
  readiness?: LoopReadinessSummary;
  export: CanvasLoopLabExport;
  report: CanvasLoopReport;
  workspacePath?: string;
  reportPath?: string;
  realMetricsUsed?: boolean;
  metricWarnings?: string[];
  safety: { aiUsed: false; apiCallsMade: false; networkCalls: false; generatedMediaCommitted: false; providerId: string };
}

const ENGINE_VERSION = 'canvas-loop-local-mvp-0.1';

function assertNoAiCalls(): string {
  // The mock provider is the only provider wired in. It must never be invoked by
  // the local lab; this asserts the local path stays fully offline.
  const mock = new MockAIProvider();
  if (mock.calls.length !== 0) throw new Error('Canvas lab must not call any AI provider method');
  return mock.getProviderCapabilities().providerId;
}

function syntheticFrames(): { anchorFrame: ExtractedFrame; frames: ExtractedFrame[] } {
  const anchorFrame: ExtractedFrame = { sourceId: 'lab-fixture', timestampSec: 0, frameIndex: 0, metrics: { brightness: 0.5, colorVector: [120, 80, 200], motionMagnitude: 0.2 } };
  const frames: ExtractedFrame[] = [
    { sourceId: 'lab-fixture', timestampSec: 3.2, frameIndex: 96, metrics: { visualSimilarity: 0.82, brightness: 0.53, colorVector: [124, 78, 198], motionMagnitude: 0.25 } },
    { sourceId: 'lab-fixture', timestampSec: 5.8, frameIndex: 174, metrics: { visualSimilarity: 0.62, brightness: 0.7, colorVector: [180, 90, 210], motionMagnitude: 0.7 } },
  ];
  return { anchorFrame, frames };
}

/** Logic-only slice: synthetic frames -> validate -> anchor -> rank -> readiness -> PLAN export (no execution). */
function runLogicOnlyLab(options: CanvasLoopLabOptions, providerId: string): CanvasLoopLabReport {
  const spec: CanvasVideoSpec = { filePath: '/tmp/song-studio-canvas-fixture.mp4', fileType: 'mp4', durationSec: 6, width: 1080, height: 1920, fps: 30, codec: 'h264' };
  const validation = validateCanvasVideoSpec(spec);
  const anchor = createLoopAnchor({ sourceId: 'lab-fixture', sourceFilePath: spec.filePath, timestampSec: 0, fps: spec.fps, notes: 'canvas lab logic-only fixture' });
  const { anchorFrame, frames } = syntheticFrames();
  const candidates = findLoopCandidates(anchor, anchorFrame, frames, { topN: 3, minSimilarityScore: 0.5 });
  const [candidate] = candidates;
  if (!candidate) throw new Error('Canvas lab (logic-only) expected at least one loop candidate');
  const readiness = summarizeLoopReadiness(candidate, validation);
  const method = options.method ?? readiness.recommendedMethod;
  const exportResult = planLocalLoopExport({ inputPath: spec.filePath, outputPath: '/tmp/song-studio-canvas-loop.mp4', anchor, candidate, method });
  const report = generateCanvasLoopReport({ inputFile: spec.filePath, validation, anchor, candidate, methodSelected: method, exportResult });

  return {
    mode: 'logic-only', generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION,
    validationOk: validation.ok, validationErrors: validation.errors.map((e) => e.message), validationWarnings: validation.warnings.map((w) => w.message),
    anchorTimeSec: anchor.timestampSec, candidateCount: candidates.length,
    bestCandidate: { timestampSec: candidate.endFrame.timestampSec, loopDurationSec: candidate.loopDurationSec, rank: candidate.rank },
    loopScore: candidate.score, readiness,
    export: { method, planned: true, executed: false, ok: true, plannedArgsCount: exportResult.plan.args.length },
    report,
    safety: { aiUsed: false, apiCallsMade: false, networkCalls: false, generatedMediaCommitted: false, providerId },
  };
}

/** Full slice: generate fixture -> extract real frames/metrics -> rank -> readiness -> PLAN + EXECUTE export -> verify MP4. */
async function runFfmpegLab(options: CanvasLoopLabOptions, providerId: string): Promise<CanvasLoopLabReport> {
  const durationSec = options.fixtureDurationSec ?? 6;
  const workspace: CanvasWorkspacePaths = createCanvasWorkspace({ prefix: 'song-studio-canvas-lab-' });
  const inputVideoPath = canvasWorkspacePath(workspace, 'source', 'canvas-fixture.mp4');
  const fixture = await generateCanvasFixtureVideo(inputVideoPath, durationSec);
  if (!fixture.ok) throw new Error(`Canvas lab fixture generation failed: ${fixture.stderrTail ?? 'unknown FFmpeg error'}`);

  const spec: CanvasVideoSpec = { filePath: inputVideoPath, fileType: 'mp4', durationSec, width: 180, height: 320, fps: 12, codec: 'h264', fileSizeBytes: fixture.bytes };
  const validation = validateCanvasVideoSpec(spec);
  if (!validation.ok) throw new Error(`Canvas lab fixture validation failed: ${validation.errors.map((e) => e.message).join('; ')}`);

  const anchor = createLoopAnchor({ sourceId: 'lab-fixture', sourceFilePath: inputVideoPath, timestampSec: 0, fps: spec.fps, notes: 'canvas lab generated fixture' });
  const anchorExtraction = await extractAnchorFrameForHarness(inputVideoPath, canvasWorkspacePath(workspace, 'anchor', 'anchor-0001.png'), anchor.timestampSec, { sourceId: 'lab-fixture', fps: spec.fps, maxWidth: 180 });
  const candidateExtraction = await extractCandidateFramesForHarness(inputVideoPath, canvasWorkspacePath(workspace, 'candidatePattern', 'candidate-%04d.png'), 0, spec.durationSec, { sourceId: 'lab-fixture', fps: 2, maxWidth: 180, anchorFrame: anchorExtraction.frame });

  // Carry a real adjacent-frame motion sample onto the anchor so motion continuity is meaningful (mirrors the smoke).
  const motionFrame = candidateExtraction.frames.find((f) => f.metrics?.motionMetricSource === 'adjacent-frame-delta') ?? candidateExtraction.frames[0];
  const scoringAnchorFrame: ExtractedFrame = motionFrame?.metrics
    ? { ...anchorExtraction.frame, metrics: { ...anchorExtraction.frame.metrics, motionMagnitude: motionFrame.metrics.motionMagnitude, temporalSimilarity: motionFrame.metrics.temporalSimilarity, motionDelta: motionFrame.metrics.motionDelta, motionMetricSource: motionFrame.metrics.motionMetricSource } }
    : anchorExtraction.frame;

  const candidates = findLoopCandidates(anchor, scoringAnchorFrame, candidateExtraction.frames, { topN: 3, minSimilarityScore: 0.45 });
  const [candidate] = candidates;
  if (!candidate) throw new Error('Canvas lab expected generated frames to produce at least one loop candidate');

  const readiness = summarizeLoopReadiness(candidate, validation);
  const method = options.method ?? readiness.recommendedMethod;
  const outputPath = canvasWorkspacePath(workspace, 'export', 'canvas-loop.mp4');
  const exportResult = planLocalLoopExport({ inputPath: inputVideoPath, outputPath, anchor, candidate, method });

  // The new step: actually execute the planned loop export and verify the file.
  const run = await runCanvasFfmpegPlan(exportResult.plan);
  const exportOk = run.ok && Boolean(run.bytes && run.bytes > 0);
  const exportRecord: CanvasLoopLabExport = {
    method, planned: true, executed: true, ok: exportOk, plannedArgsCount: exportResult.plan.args.length,
    outputPath: run.outputPath, bytes: run.bytes, ffmpegPath: run.ffmpegPath, durationMs: run.durationMs, stderrTail: run.stderrTail,
  };

  const reportWarnings = [...anchorExtraction.metricWarnings, ...candidateExtraction.metricWarnings];
  if (!exportOk) reportWarnings.push(`Local ${method} export did not produce a valid MP4.`);
  const report = generateCanvasLoopReport({ inputFile: inputVideoPath, validation, anchor, candidate, methodSelected: method, exportResult: { ...exportResult, outputPath: exportOk ? run.outputPath : undefined }, warnings: reportWarnings });

  const labReport: CanvasLoopLabReport = {
    mode: 'ffmpeg', generatedAt: new Date().toISOString(), engineVersion: ENGINE_VERSION,
    validationOk: validation.ok, validationErrors: validation.errors.map((e) => e.message), validationWarnings: validation.warnings.map((w) => w.message),
    anchorTimeSec: anchor.timestampSec, candidateCount: candidates.length,
    bestCandidate: { timestampSec: candidate.endFrame.timestampSec, loopDurationSec: candidate.loopDurationSec, rank: candidate.rank },
    loopScore: candidate.score, readiness,
    export: exportRecord, report,
    workspacePath: workspace.root,
    realMetricsUsed: anchorExtraction.realMetricsUsed && candidateExtraction.realMetricsUsed,
    metricWarnings: reportWarnings,
    safety: { aiUsed: false, apiCallsMade: false, networkCalls: false, generatedMediaCommitted: false, providerId },
  };

  const reportPath = canvasWorkspacePath(workspace, 'report', 'canvas-lab-report.json');
  writeFileSync(reportPath, `${JSON.stringify(labReport, null, 2)}\n`);
  labReport.reportPath = reportPath;
  return labReport;
}

export async function runCanvasLoopLab(options: CanvasLoopLabOptions = {}): Promise<CanvasLoopLabReport> {
  const providerId = assertNoAiCalls();
  const mode = options.mode ?? 'logic-only';
  return mode === 'ffmpeg' ? runFfmpegLab(options, providerId) : runLogicOnlyLab(options, providerId);
}
