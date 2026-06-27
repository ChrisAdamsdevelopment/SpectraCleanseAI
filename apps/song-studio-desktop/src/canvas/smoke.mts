import { createLoopAnchor, findLoopCandidates, generateCanvasLoopReport, MockAIProvider, planLocalLoopExport, validateCanvasVideoSpec } from './index.ts';
import type { CanvasVideoSpec, ExtractedFrame } from './index.ts';

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
console.log(JSON.stringify({ ok: report.validation.ok, candidateRank: candidate.rank, method: report.methodSelected, aiUsed: report.ai.used, plannedArgs: exportResult.plan.args.length }, null, 2));
