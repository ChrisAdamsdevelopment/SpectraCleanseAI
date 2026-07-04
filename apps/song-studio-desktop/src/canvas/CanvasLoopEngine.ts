import { createLoopAnchor, type AnchorInput } from './AnchorSelector';
import { findLoopCandidates, type CandidateFinderOptions } from './LoopCandidateFinder';
import { planLocalLoopExport } from './LocalLoopExporter';
import { generateCanvasLoopReport } from './ReportGenerator';
import { validateCanvasVideoSpec } from './VideoSpecValidator';
import type { CanvasLoopReport, CanvasVideoSpec, ExtractedFrame, LoopExportRequest, LoopRepairMethod } from './types';

export interface CanvasLoopEngineInput { spec: CanvasVideoSpec; anchor: AnchorInput; anchorFrame: ExtractedFrame; frames: ExtractedFrame[]; method?: LoopRepairMethod; outputPath?: string; finder?: CandidateFinderOptions }

export function planCanvasLoop(input: CanvasLoopEngineInput): CanvasLoopReport {
  const validation = validateCanvasVideoSpec(input.spec);
  const anchor = createLoopAnchor(input.anchor);
  const [candidate] = findLoopCandidates(anchor, input.anchorFrame, input.frames, input.finder);
  const exportResult = candidate && input.outputPath ? planLocalLoopExport({ inputPath: input.spec.filePath, outputPath: input.outputPath, anchor, candidate, method: input.method ?? 'crossfade' } satisfies LoopExportRequest) : undefined;
  return generateCanvasLoopReport({ inputFile: input.spec.filePath, validation, anchor, candidate, methodSelected: input.method ?? 'crossfade', exportResult, warnings: candidate ? [] : ['No loop candidate matched the current constraints.'] });
}
