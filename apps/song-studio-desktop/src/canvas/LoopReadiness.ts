import type { CanvasValidationResult, LoopCandidate, LoopRepairMethod } from './types';

// Pure explainability layer over a scored LoopCandidate. No FFmpeg, no Node, no
// network — safe for the desktop UI and (later) the AI-evaluation layer to import
// directly. Turns the raw LoopScore breakdown into a human-readable readiness
// verdict + a recommended local repair method, and flags whether a local-only
// export is likely enough or whether the seam may eventually want AI repair.

export type LoopReadinessRating = 'ready' | 'minor-repair' | 'needs-repair' | 'weak';

export interface LoopReadinessSummary {
  readinessScore: number;          // 0..1 — mirrors candidate.score.overall
  rating: LoopReadinessRating;
  strengths: string[];
  risks: string[];
  recommendedMethod: LoopRepairMethod;
  rationale: string;
  localExportLikelySufficient: boolean;
  mayBenefitFromAi: boolean;       // never triggers a call — just a signal for the future AI layer
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Local-first method recommendation, mirroring the decision flow in the roadmap:
 * a clean seam needs no repair, a medium seam wants a crossfade, a low-similarity
 * seam falls back to ping-pong, and an in-between case gets a short frame blend.
 */
export function recommendRepairMethod(candidate: LoopCandidate): LoopRepairMethod {
  const s = candidate.score;
  if (s.overall >= 0.85 && s.jumpRisk <= 0.15) return 'hard-cut';
  if (s.jumpRisk <= 0.45) return 'crossfade';
  if (s.visualSimilarity < 0.4) return 'ping-pong';
  return 'frame-blend';
}

export function summarizeLoopReadiness(candidate: LoopCandidate, validation?: CanvasValidationResult): LoopReadinessSummary {
  const s = candidate.score;
  const readinessScore = s.overall;
  const rating: LoopReadinessRating = readinessScore >= 0.8 ? 'ready'
    : readinessScore >= 0.6 ? 'minor-repair'
    : readinessScore >= 0.4 ? 'needs-repair'
    : 'weak';

  const strengths: string[] = [];
  if (s.visualSimilarity >= 0.75) strengths.push(`Strong visual match at the seam (${pct(s.visualSimilarity)}).`);
  if (s.brightnessContinuity >= 0.8) strengths.push(`Brightness is continuous across the loop point (${pct(s.brightnessContinuity)}).`);
  if (s.colorContinuity >= 0.8) strengths.push(`Color palette stays consistent (${pct(s.colorContinuity)}).`);
  if (s.motionContinuity >= 0.7) strengths.push(`Motion carries through the seam (${pct(s.motionContinuity)}).`);
  if (s.durationFit >= 0.7) strengths.push(`Loop length fits the Canvas 3–8s window well.`);
  if (strengths.length === 0) strengths.push('No standout strengths; this candidate is a marginal match.');

  const risks: string[] = [];
  if (s.visualSimilarity < 0.6) risks.push(`End frame does not closely match the anchor (${pct(s.visualSimilarity)}).`);
  if (s.brightnessContinuity < 0.6) risks.push(`Brightness jumps at the loop point (${pct(s.brightnessContinuity)}).`);
  if (s.colorContinuity < 0.6) risks.push(`Color shifts at the loop point (${pct(s.colorContinuity)}).`);
  if (s.motionContinuity < 0.5) risks.push(`Motion direction breaks at the seam (${pct(s.motionContinuity)}).`);
  if (s.durationFit <= 0) risks.push('Loop length falls outside the preferred 3–8s window.');
  if (s.jumpRisk >= 0.5) risks.push(`High visible-restart risk (${pct(s.jumpRisk)}).`);
  for (const issue of validation?.errors ?? []) risks.push(`Validation error: ${issue.message}`);
  if (risks.length === 0) risks.push('No significant risks detected.');

  const recommendedMethod = recommendRepairMethod(candidate);
  const localExportLikelySufficient = readinessScore >= 0.6 && s.jumpRisk <= 0.5 && (validation?.ok ?? true);
  const mayBenefitFromAi = readinessScore < 0.5 || s.jumpRisk > 0.6;

  const rationale = localExportLikelySufficient
    ? `Local ${recommendedMethod} export should produce a usable loop (readiness ${pct(readinessScore)}, jump risk ${pct(s.jumpRisk)}).`
    : mayBenefitFromAi
      ? `Local ${recommendedMethod} repair is the best local option, but the seam is weak (readiness ${pct(readinessScore)}, jump risk ${pct(s.jumpRisk)}); AI repair/generation may be needed later.`
      : `Try a local ${recommendedMethod} export; readiness is moderate (${pct(readinessScore)}).`;

  return { readinessScore, rating, strengths, risks, recommendedMethod, rationale, localExportLikelySufficient, mayBenefitFromAi };
}
