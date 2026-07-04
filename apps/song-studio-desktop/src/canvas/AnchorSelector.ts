import type { LoopAnchor } from './types';

export interface AnchorInput {
  sourceId: string;
  sourceFilePath?: string;
  timestampSec: number;
  fps?: number;
  frameIndex?: number;
  previewFramePath?: string;
  notes?: string;
  createdAt?: string;
}

export function createLoopAnchor(input: AnchorInput): LoopAnchor {
  const timestampSec = Math.max(0, Number(input.timestampSec.toFixed(3)));
  return {
    sourceId: input.sourceId,
    sourceFilePath: input.sourceFilePath,
    timestampSec,
    frameIndex: input.frameIndex ?? (input.fps ? Math.round(timestampSec * input.fps) : undefined),
    previewFramePath: input.previewFramePath,
    notes: input.notes,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}
