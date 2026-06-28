import { runCanvasLoopLab } from './CanvasLoopLab.ts';
import type { LoopRepairMethod } from './index.ts';

// Internal Canvas Loop "lab" runner — a local end-to-end vertical slice for
// evaluation/demo. NOT production UI. No network, no AI, no paid API calls, no
// committed media; all outputs land in a temp workspace.
//
//   npm run canvas:lab                 # logic-only slice (plans export, no FFmpeg)
//   npm run canvas:lab -- --ffmpeg     # full slice: generates a fixture and
//                                      # EXECUTES a real local loop export
//   npm run canvas:lab -- --ffmpeg --method=ping-pong

const VALID_METHODS: LoopRepairMethod[] = ['hard-cut', 'crossfade', 'ping-pong', 'frame-blend'];

const mode = process.argv.includes('--ffmpeg') ? 'ffmpeg' : 'logic-only';
const methodArg = process.argv.find((a) => a.startsWith('--method='))?.split('=')[1];
if (methodArg && !VALID_METHODS.includes(methodArg as LoopRepairMethod)) {
  throw new Error(`Unknown --method=${methodArg}. Expected one of: ${VALID_METHODS.join(', ')}`);
}

const report = await runCanvasLoopLab({ mode, method: methodArg as LoopRepairMethod | undefined });

// Console summary (the full structured report is written to the temp workspace in ffmpeg mode).
console.log(JSON.stringify({
  mode: report.mode,
  validationOk: report.validationOk,
  anchorTimeSec: report.anchorTimeSec,
  candidateCount: report.candidateCount,
  bestCandidate: report.bestCandidate,
  loopScore: report.loopScore?.overall,
  readiness: report.readiness && {
    rating: report.readiness.rating,
    readinessScore: report.readiness.readinessScore,
    recommendedMethod: report.readiness.recommendedMethod,
    localExportLikelySufficient: report.readiness.localExportLikelySufficient,
    mayBenefitFromAi: report.readiness.mayBenefitFromAi,
    rationale: report.readiness.rationale,
  },
  export: report.export,
  reportPath: report.reportPath,
  workspacePath: report.workspacePath,
  safety: report.safety,
}, null, 2));

// Assertions — fail loudly so the command doubles as a check.
if (!report.readiness) throw new Error('Canvas lab expected a readiness summary');
const s = report.safety;
if (s.aiUsed !== false || s.apiCallsMade !== false || s.networkCalls !== false || s.generatedMediaCommitted !== false) {
  throw new Error('Canvas lab safety flags must all be false');
}
if (mode === 'ffmpeg') {
  if (!report.export.executed) throw new Error('Canvas lab (ffmpeg) expected the export to execute');
  if (!report.export.ok) throw new Error(`Canvas lab (ffmpeg) export failed: ${report.export.stderrTail ?? 'unknown error'}`);
  if (!report.export.bytes || report.export.bytes <= 0) throw new Error('Canvas lab (ffmpeg) produced an empty loop file');
  if (!report.reportPath) throw new Error('Canvas lab (ffmpeg) expected a written report path');
} else if (report.export.executed) {
  throw new Error('Canvas lab (logic-only) should plan the export without executing FFmpeg');
}

console.error(`[canvas:lab] OK — ${mode} slice; export method=${report.export.method} executed=${report.export.executed} ok=${report.export.ok}`);
