import { formatTime } from '../lib/time';
import type { SongMoment, SongProject } from '../project/types';
import { getPromoDirectionCandidate } from '../promo/directions';
import type { RenderPlan } from '../render/plan';
import type { Composition } from '../render/types';

export interface ExportReviewRow {
  label: string;
  value: string;
}

export interface ExportReview {
  ready: boolean;
  title: string;
  summary: string;
  essentials: ExportReviewRow[];
  warnings: string[];
  blockers: string[];
  nextAction: string;
}

interface ExportReviewInput {
  project: SongProject;
  plan: RenderPlan;
  composition: Composition;
  selectedMoment: SongMoment | null;
}

function formatRange(startSec: number, endSec: number): string {
  return `${formatTime(startSec)}–${formatTime(endSec)}`;
}

function momentLabel(moment: SongMoment | null, plan: RenderPlan): string {
  if (moment) return `${moment.label} · ${formatRange(moment.startSec, moment.endSec)} (${Math.round(moment.durationSec)}s)`;
  if (plan.audio) return `Manual clip timing · ${formatRange(plan.audioStartSec, plan.audioEndSec)}`;
  return 'Silent loop — no song moment used';
}

function directionLabel(project: SongProject): string {
  if (!project.selectedPromoDirectionId) return 'No promo vibe selected';
  const direction = getPromoDirectionCandidate(project, project.selectedPromoDirectionId);
  return direction ? direction.label : 'Previously selected direction unavailable';
}

export function buildExportReview({ project, plan, composition, selectedMoment }: ExportReviewInput): ExportReview {
  const blockers = [...plan.errors];
  const warnings: string[] = [];

  if (plan.audio && !selectedMoment) warnings.push('No song moment selected; Song Studio will use the manual start and length.');
  if (!project.selectedPromoDirectionId) warnings.push('No promo vibe selected; Song Studio will use the current look.');
  if (!project.title.trim()) warnings.push('Song title is missing, so the MP4 will use a generic file name and no title text.');
  if (plan.durationSec < 6) warnings.push('Very short duration; the promo may end before the hook lands.');
  if (plan.durationSec > 30) warnings.push('Unusually long duration for a short-form promo.');
  if (composition.layers.length === 0) warnings.push('The preview has no visible design pieces, so the MP4 may look empty.');

  const ready = blockers.length === 0;
  const title = ready ? 'Ready to create MP4' : 'Needs attention before you create the MP4';
  const songLine = plan.audio
    ? `Uses your song from ${formatRange(plan.audioStartSec, plan.audioEndSec)}`
    : 'Silent — this promo does not use your song';
  const summary = ready
    ? `${songLine} · ${plan.recipeName || 'selected style'}.`
    : 'Fix the missing essentials below before creating your MP4.';

  return {
    ready,
    title,
    summary,
    blockers,
    warnings,
    nextAction: ready ? 'Create MP4' : blockers[0] ?? 'Review the essentials',
    essentials: [
      { label: 'What you’re making', value: [plan.functionLabel, plan.recipeName].filter(Boolean).join(' · ') || 'Choose a promo type' },
      { label: 'Song moment', value: momentLabel(selectedMoment, plan) },
      { label: 'Direction', value: directionLabel(project) },
      { label: 'Assets', value: `Cover art ${project.coverPath ? 'ready' : 'missing'} · Song ${plan.audio ? (project.audioPath ? 'ready' : 'missing') : 'not needed'} · Save folder ${project.outputDir ? 'ready' : 'missing'}` },
      { label: 'Format', value: `${plan.width}×${plan.height} MP4 · ${plan.durationSec}s` },
      { label: 'Song section', value: plan.audio ? formatRange(plan.audioStartSec, plan.audioEndSec) : 'No song audio' },
      { label: 'File name', value: plan.outputName },
    ],
  };
}
