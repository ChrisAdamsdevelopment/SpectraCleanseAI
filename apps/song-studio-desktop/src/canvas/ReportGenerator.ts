import type { CanvasLoopReport, CanvasValidationResult, LoopAnchor, LoopCandidate, LoopExportResult, LoopRepairMethod } from './types';

export function generateCanvasLoopReport(input: { inputFile: string; validation: CanvasValidationResult; anchor: LoopAnchor; candidate?: LoopCandidate; methodSelected?: LoopRepairMethod; exportResult?: LoopExportResult; warnings?: string[] }): CanvasLoopReport {
  const warningMessages = [...input.validation.warnings.map((warning) => warning.message), ...(input.warnings ?? []), ...(input.exportResult?.warnings ?? [])];
  return {
    inputFile: input.inputFile,
    validation: input.validation,
    anchorTimeSec: input.anchor.timestampSec,
    candidateEndTimeSec: input.candidate?.endFrame.timestampSec,
    loopDurationSec: input.candidate?.loopDurationSec,
    score: input.candidate?.score,
    methodSelected: input.methodSelected,
    warnings: warningMessages,
    exportPath: input.exportResult?.outputPath,
    ai: { used: false, note: 'AI provider disabled; local MVP report only.' },
    provenance: { engineVersion: 'canvas-loop-local-mvp-0.1', generatedAt: new Date().toISOString(), source: 'local-planning' },
  };
}
