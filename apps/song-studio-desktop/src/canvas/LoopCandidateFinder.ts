import type { ExtractedFrame, LoopAnchor, LoopCandidate } from './types';
import { scoreLoop } from './LoopScorer';

export interface CandidateFinderOptions { minDurationSec?: number; maxDurationSec?: number; candidateSpacingSec?: number; minSimilarityScore?: number; topN?: number }

export function findLoopCandidates(anchor: LoopAnchor, anchorFrame: ExtractedFrame, frames: ExtractedFrame[], options: CandidateFinderOptions = {}): LoopCandidate[] {
  const minDurationSec = options.minDurationSec ?? 3;
  const maxDurationSec = options.maxDurationSec ?? 8;
  const spacing = options.candidateSpacingSec ?? 0;
  const minSimilarity = options.minSimilarityScore ?? 0;
  let lastAccepted = -Infinity;
  const candidates = frames
    .filter((frame) => frame.timestampSec - anchor.timestampSec >= minDurationSec && frame.timestampSec - anchor.timestampSec <= maxDurationSec)
    .filter((frame) => {
      if (frame.timestampSec - lastAccepted < spacing) return false;
      lastAccepted = frame.timestampSec;
      return true;
    })
    .map((frame) => {
      const score = scoreLoop(anchorFrame, frame, anchor, minDurationSec, maxDurationSec);
      return { anchor, endFrame: frame, loopDurationSec: frame.timestampSec - anchor.timestampSec, score, rank: 0, reasons: score.reasons };
    })
    .filter((candidate) => candidate.score.visualSimilarity >= minSimilarity)
    .sort((a, b) => b.score.overall - a.score.overall)
    .slice(0, options.topN ?? 5);
  return candidates.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
