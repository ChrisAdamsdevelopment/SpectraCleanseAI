import type { SongAnalysis, SongMoment, SongMomentKind } from '../project/types';

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const round1 = (value: number) => Math.round(value * 10) / 10;

function makeMoment(
  id: string,
  label: string,
  kind: SongMomentKind,
  startSec: number,
  durationSec: number,
  confidence: number,
  reason: string,
  source: SongMoment['source'] = 'duration-heuristic',
): SongMoment {
  const safeStart = round1(Math.max(0, startSec));
  const safeDuration = round1(clamp(durationSec, 3, 60));
  return { id, label, kind, startSec: safeStart, durationSec: safeDuration, endSec: round1(safeStart + safeDuration), confidence: round1(clamp(confidence, 0, 1)), reason, source };
}

function fitStart(preferredStart: number, durationSec: number, audioDurationSec: number): number {
  return clamp(preferredStart, 0, Math.max(0, audioDurationSec - durationSec));
}

function fitDuration(preferredDuration: number, startSec: number, audioDurationSec: number): number {
  return clamp(Math.min(preferredDuration, Math.max(3, audioDurationSec - startSec)), 3, 60);
}

export function buildSongAnalysis({ audioPath, durationSec, manualStartSec, manualDurationSec, selectedMomentId, analyzedAt = new Date().toISOString() }: {
  audioPath: string;
  durationSec: number;
  manualStartSec?: number | null;
  manualDurationSec?: number | null;
  selectedMomentId?: string | null;
  analyzedAt?: string;
}): SongAnalysis {
  const safeDuration = round1(Math.max(0, durationSec || 0));
  const moments: SongMoment[] = [];

  if (safeDuration >= 3) {
    const teaserDur = fitDuration(Math.min(6, safeDuration), 0, safeDuration);
    moments.push(makeMoment('teaser-open', 'Short teaser', 'teaser', 0, teaserDur, 0.62, 'Starts immediately and keeps the promo short.'));

    const earlyDur = fitDuration(Math.min(15, safeDuration), fitStart(Math.min(8, safeDuration * 0.08), 15, safeDuration), safeDuration);
    const earlyStart = fitStart(Math.min(8, safeDuration * 0.08), earlyDur, safeDuration);
    moments.push(makeMoment('early-usable', 'Early usable section', 'early', earlyStart, earlyDur, 0.68, 'Skips a small intro while staying near the beginning of the song.'));

    if (safeDuration >= 18) {
      const impactDur = fitDuration(Math.min(15, safeDuration), fitStart(safeDuration * 0.38, 15, safeDuration), safeDuration);
      const impactStart = fitStart(safeDuration * 0.38, impactDur, safeDuration);
      moments.push(makeMoment('mid-impact', 'Middle impact estimate', 'middle', impactStart, impactDur, 0.58, 'Uses the middle of the track as a deterministic high-impact approximation.'));
    }

    if (safeDuration >= 24) {
      const promoDur = fitDuration(Math.min(30, safeDuration), fitStart(safeDuration * 0.22, 30, safeDuration), safeDuration);
      const promoStart = fitStart(safeDuration * 0.22, promoDur, safeDuration);
      moments.push(makeMoment('longer-promo', 'Longer promo section', 'promo', promoStart, promoDur, 0.54, 'Gives more context for a longer social clip.'));
    }
  }

  if (manualStartSec !== null && manualStartSec !== undefined && manualDurationSec !== null && manualDurationSec !== undefined && manualDurationSec >= 3) {
    const manualDur = fitDuration(manualDurationSec, manualStartSec, Math.max(safeDuration, manualStartSec + manualDurationSec));
    moments.push(makeMoment('manual-current', 'Current manual selection', 'manual', manualStartSec, manualDur, 0.5, 'Matches the clip start and duration currently entered below.', 'manual'));
  }

  return { audioPath, analyzedAt, durationSec: safeDuration, moments: moments.slice(0, 5), selectedMomentId: selectedMomentId ?? null };
}

// Pick a sensible default song section so a music promo always has the song in
// use without the creator hunting for it. Prefers the highest-confidence
// auto-suggested moment (a manual selection is only used as a last resort).
export function pickDefaultMoment(analysis: SongAnalysis | null): SongMoment | null {
  if (!analysis || analysis.moments.length === 0) return null;
  const auto = analysis.moments.filter((m) => m.source !== 'manual');
  const pool = auto.length > 0 ? auto : analysis.moments;
  return pool.reduce((best, moment) => (moment.confidence > best.confidence ? moment : best), pool[0]);
}
