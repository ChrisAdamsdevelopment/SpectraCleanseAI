import { writeFileSync } from 'node:fs';
import { canvasWorkspacePath, createCanvasWorkspace, createLoopAnchor, extractAnchorFrameForHarness, extractCandidateFramesForHarness, findLoopCandidates, generateCanvasFixtureVideo, generateCanvasLoopReport, MockAIProvider, planLocalLoopExport, validateCanvasVideoSpec } from './index.ts';
import type { CanvasVideoSpec, ExtractedFrame } from './index.ts';

const mode = process.argv.includes('--ffmpeg') ? 'ffmpeg' : 'logic-only';

function runLogicOnlySmoke(): void {
  const spec: CanvasVideoSpec = { filePath: '/tmp/song-studio-canvas-fixture.mp4', fileType: 'mp4', durationSec: 6, width: 1080, height: 1920, fps: 30, codec: 'h264' };
  const validation = validateCanvasVideoSpec(spec);
  const anchor = createLoopAnchor({ sourceId: 'fixture', sourceFilePath: spec.filePath, timestampSec: 0, fps: spec.fps, notes: 'smoke fixture' });
  const anchorFrame: ExtractedFrame = { sourceId: 'fixture', timestampSec: 0, frameIndex: 0, metrics: { brightness: 0.5, colorVector: [120, 80, 200], motionMagnitude: 0.2 } };
  const frames: ExtractedFrame[] = [
    { sourceId: 'fixture', timestampSec: 3.2, frameIndex: 96, metrics: { visualSimilarity: 0.82, brightness: 0.53, colorVector: [124, 78, 198], motionMagnitude: 0.25 } },
    { sourceId: 'fixture', timestampSec: 5.8, frameIndex: 174, metrics: { visualSimilarity: 0.62, brightness: 0.7, colorVector: [180, 90, 210], motionMagnitude: 0.7 } },
  ];
  const [candidate] = findLoopCandidates(anchor, anchorFrame, frames, { topN: 2, minSimilarityScore: 0.5 });
  if (!validation.ok) throw new Error('Expected smoke validation to pass');
  if (!candidate) throw new Error('Expected at least one loop candidate');
  const exportResult = planLocalLoopExport({ inputPath: spec.filePath, outputPath: '/tmp/song-studio-canvas-loop.mp4', anchor, candidate, method: 'crossfade' });
  const report = generateCanvasLoopReport({ inputFile: spec.filePath, validation, anchor, candidate, methodSelected: 'crossfade', exportResult });
  const mock = new MockAIProvider();
  if (mock.calls.length !== 0) throw new Error('Smoke test should not call AI provider methods');
  console.log(JSON.stringify({ mode, ok: report.validation.ok, candidateRank: candidate.rank, method: report.methodSelected, aiUsed: report.ai.used, plannedArgs: exportResult.plan.args.length }, null, 2));
}

async function runFfmpegSmoke(): Promise<void> {
  const workspace = createCanvasWorkspace();
  const inputVideoPath = canvasWorkspacePath(workspace, 'source', 'canvas-fixture.mp4');
  const fixture = await generateCanvasFixtureVideo(inputVideoPath, 5);
  if (!fixture.ok) throw new Error(`Fixture generation failed: ${fixture.stderrTail ?? 'unknown FFmpeg error'}`);

  const spec: CanvasVideoSpec = { filePath: inputVideoPath, fileType: 'mp4', durationSec: 5, width: 180, height: 320, fps: 12, codec: 'h264', fileSizeBytes: fixture.bytes };
  const validation = validateCanvasVideoSpec(spec);
  if (!validation.ok) throw new Error(`Expected generated fixture validation to pass: ${validation.errors.map((e) => e.message).join('; ')}`);

  const anchor = createLoopAnchor({ sourceId: 'generated-fixture', sourceFilePath: inputVideoPath, timestampSec: 0, fps: spec.fps, notes: 'generated harness fixture' });
  const anchorExtraction = await extractAnchorFrameForHarness(inputVideoPath, canvasWorkspacePath(workspace, 'anchor', 'anchor-0001.png'), anchor.timestampSec, { sourceId: 'generated-fixture', fps: spec.fps, maxWidth: 180 });
  const candidateExtraction = await extractCandidateFramesForHarness(inputVideoPath, canvasWorkspacePath(workspace, 'candidatePattern', 'candidate-%04d.png'), 0, spec.durationSec, { sourceId: 'generated-fixture', fps: 2, maxWidth: 180 });
  const candidates = findLoopCandidates(anchor, anchorExtraction.frame, candidateExtraction.frames, { topN: 3, minSimilarityScore: 0.45 });
  const [candidate] = candidates;
  if (!candidate) throw new Error('Expected generated frames to produce at least one loop candidate');

  const exportResult = planLocalLoopExport({ inputPath: inputVideoPath, outputPath: canvasWorkspacePath(workspace, 'export', 'planned-canvas-loop.mp4'), anchor, candidate, method: 'crossfade' });
  const report = generateCanvasLoopReport({ inputFile: inputVideoPath, validation, anchor, candidate, methodSelected: 'crossfade', exportResult });
  const harnessReport = {
    inputVideoPath,
    workspacePath: workspace.root,
    frameExtractionPlan: candidateExtraction.plan,
    anchorExtractionPlan: anchorExtraction.plan,
    framesExtracted: candidateExtraction.frames.length,
    anchorFramePath: anchorExtraction.frame.framePath,
    candidateCount: candidates.length,
    bestCandidateTimestampSec: candidate.endFrame.timestampSec,
    loopScore: candidate.score,
    plannedExportMethod: report.methodSelected,
    plannedExport: exportResult.plan,
    aiUsed: false,
    apiCallsMade: false,
    generatedMediaCommitted: false,
  };
  const reportPath = canvasWorkspacePath(workspace, 'report', 'canvas-frame-extraction-harness-report.json');
  writeFileSync(reportPath, `${JSON.stringify(harnessReport, null, 2)}\n`);

  const mock = new MockAIProvider();
  if (mock.calls.length !== 0) throw new Error('FFmpeg smoke should not call AI provider methods');
  console.log(JSON.stringify({ mode, ok: true, workspace: workspace.root, inputVideoPath, framesExtracted: harnessReport.framesExtracted, anchorFramePath: harnessReport.anchorFramePath, candidateCount: harnessReport.candidateCount, bestCandidateTimestampSec: harnessReport.bestCandidateTimestampSec, loopScore: candidate.score.overall, plannedExportMethod: harnessReport.plannedExportMethod, reportPath, aiUsed: false, apiCallsMade: false, generatedMediaCommitted: false }, null, 2));
}

if (mode === 'ffmpeg') {
  await runFfmpegSmoke();
} else {
  runLogicOnlySmoke();
}
