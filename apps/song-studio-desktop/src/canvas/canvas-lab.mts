import { runCanvasLoopLab } from './CanvasLoopLab.ts';
import { CANVAS_LAB_METHODS, isLoopRepairMethod, type CanvasLabControls, type CanvasLabMethodChoice } from './CanvasLabControls.ts';

// Internal Canvas Loop "lab" — the local operator/evaluation control surface for
// the engine. NOT production UI. No network, no AI, no cloud, no paid calls, no
// committed media; outputs land in a temp (or --output-dir) workspace.
//
//   npm run canvas:lab                                  # logic-only (plan, no FFmpeg)
//   npm run canvas:lab -- --ffmpeg                      # full slice on a generated fixture
//   npm run canvas:lab -- --ffmpeg --input=/path/clip.mp4
//   npm run canvas:lab -- --ffmpeg --input=/path/clip.mp4 --anchor=0 \
//       --min-duration=3 --max-duration=8 --top-n=5 --min-similarity=0.45 \
//       --method=auto --compare-methods --output-dir=/tmp/canvas-lab

// A CLI usage error: reported cleanly (no stack) with a non-zero exit.
class CanvasLabUsageError extends Error {}

const HELP = `canvas:lab — local Canvas loop evaluation harness
Flags:
  --ffmpeg                 execute FFmpeg (otherwise logic-only planning)
  --input=PATH             real local source video (requires --ffmpeg; else a fixture is generated)
  --output-dir=PATH        local workspace/output dir (default: OS temp)
  --anchor=SEC             anchor time in seconds (default 0)
  --min-duration=SEC       minimum loop duration (default 3)
  --max-duration=SEC       maximum loop duration (default 8)
  --top-n=N                max candidates to rank (default 5)
  --min-similarity=0..1    minimum visual similarity to keep a candidate (default 0.45)
  --method=NAME            auto|${CANVAS_LAB_METHODS.join('|')} (default auto)
  --compare-methods        run/plan every local repair method and compare
  --fixture-duration=SEC   fixture length when no --input (default 6)`;

const KNOWN_FLAGS = new Set(['ffmpeg', 'input', 'output-dir', 'anchor', 'min-duration', 'max-duration', 'top-n', 'min-similarity', 'method', 'compare-methods', 'fixture-duration', 'help', 'h']);

function parseControls(argv: string[]): CanvasLabControls {
  for (const arg of argv) {
    const name = arg.replace(/^--?/, '').split('=')[0];
    if (!KNOWN_FLAGS.has(name)) throw new CanvasLabUsageError(`Unknown flag "${arg}". Run with --help to see supported flags.`);
  }

  const flag = (name: string): string | undefined => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (hit === undefined) return undefined;
    const eq = hit.indexOf('=');
    return eq === -1 ? '' : hit.slice(eq + 1);
  };
  const num = (name: string): number | undefined => {
    const raw = flag(name);
    if (raw === undefined || raw === '') return undefined;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new CanvasLabUsageError(`--${name} must be a number (got "${raw}")`);
    return value;
  };

  const methodRaw = flag('method');
  let method: CanvasLabMethodChoice | undefined;
  if (methodRaw !== undefined && methodRaw !== '') {
    if (methodRaw !== 'auto' && !isLoopRepairMethod(methodRaw)) throw new CanvasLabUsageError(`Unknown --method=${methodRaw}. Expected one of: auto, ${CANVAS_LAB_METHODS.join(', ')}`);
    method = methodRaw as CanvasLabMethodChoice;
  }

  const inputPath = flag('input') || undefined;
  const mode = argv.includes('--ffmpeg') ? 'ffmpeg' : 'logic-only';
  if (inputPath && mode !== 'ffmpeg') throw new CanvasLabUsageError('--input requires --ffmpeg (logic-only mode uses synthetic frames).');

  return {
    mode, inputPath,
    outputDir: flag('output-dir') || undefined,
    anchorTimeSec: num('anchor'),
    minDurationSec: num('min-duration'),
    maxDurationSec: num('max-duration'),
    topN: num('top-n'),
    minSimilarityScore: num('min-similarity'),
    method,
    compareMethods: argv.includes('--compare-methods'),
    fixtureDurationSec: num('fixture-duration'),
  };
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); return; }

  const controls = parseControls(argv);
  const report = await runCanvasLoopLab(controls);

  console.log(JSON.stringify({
    mode: report.mode,
    inputSource: report.inputSource,
    validationOk: report.validationOk,
    anchorTimeSec: report.anchorTimeSec,
    candidateCount: report.candidateCount,
    bestCandidate: report.bestCandidate,
    loopScore: report.loopScore?.overall,
    selectedMethod: report.selectedMethod,
    autoRecommendedMethod: report.autoRecommendedMethod,
    readiness: report.readiness && {
      rating: report.readiness.rating,
      readinessScore: report.readiness.readinessScore,
      recommendedMethod: report.readiness.recommendedMethod,
      localExportLikelySufficient: report.readiness.localExportLikelySufficient,
      mayBenefitFromAi: report.readiness.mayBenefitFromAi,
      rationale: report.readiness.rationale,
    },
    export: report.export,
    methodComparison: report.methodComparison,
    warnings: report.warnings,
    reportPath: report.reportPath,
    workspacePath: report.workspacePath,
    outputDirUserSupplied: report.outputDirUserSupplied,
    safety: report.safety,
  }, null, 2));

  // Assertions — the command doubles as a check.
  if (!report.readiness) throw new Error('Canvas lab expected a readiness summary');
  const s = report.safety;
  if (s.aiUsed !== false || s.apiCallsMade !== false || s.networkCalls !== false || s.cloudUploads !== false || s.paidCalls !== false || s.generatedMediaCommitted !== false) {
    throw new Error('Canvas lab safety flags must all be false');
  }

  if (report.mode === 'ffmpeg') {
    if (!report.reportPath) throw new Error('Canvas lab (ffmpeg) expected a written report path');
    if (controls.compareMethods) {
      if (!report.methodComparison?.length) throw new Error('compare-methods expected a method comparison array');
      if (!report.methodComparison.every((m) => m.executed)) throw new Error('compare-methods expected every method to execute');
      if (!report.methodComparison.some((m) => m.ok && (m.bytes ?? 0) > 0)) throw new Error('compare-methods: no method produced a valid MP4');
    } else {
      if (!report.export.executed) throw new Error('Canvas lab (ffmpeg) expected the export to execute');
      if (!report.export.ok || !report.export.bytes || report.export.bytes <= 0) throw new Error(`Canvas lab (ffmpeg) export failed: ${report.export.stderrTail ?? 'empty output'}`);
    }
  } else if (report.export.executed) {
    throw new Error('Canvas lab (logic-only) should plan the export without executing FFmpeg');
  }

  const okCount = report.methodComparison ? report.methodComparison.filter((m) => m.ok).length : (report.export.ok ? 1 : 0);
  console.error(`[canvas:lab] OK — ${report.mode}; input=${report.inputSource.type}; selected=${report.selectedMethod}; methodsOk=${okCount}${report.methodComparison ? `/${report.methodComparison.length}` : ''}`);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof CanvasLabUsageError) {
    console.error(`[canvas:lab] ${message}\n\n${HELP}`);
  } else {
    console.error(`[canvas:lab] failed: ${message}`);
  }
  process.exit(1);
});
