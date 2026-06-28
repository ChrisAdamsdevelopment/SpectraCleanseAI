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
  if (!project.selectedPromoDirectionId) return 'No promo direction selected';
  const direction = getPromoDirectionCandidate(project, project.selectedPromoDirectionId);
  return direction ? direction.label : 'Previously selected direction unavailable';
}

export function buildExportReview({ project, plan, composition, selectedMoment }: ExportReviewInput): ExportReview {
  const blockers = [...plan.errors];
  const warnings: string[] = [];

  if (plan.audio && !selectedMoment) warnings.push('No selected song moment; export will use the manual clip start and duration.');
  if (!project.selectedPromoDirectionId) warnings.push('No promo direction selected; export will use the current style settings.');
  if (!project.title.trim()) warnings.push('Song title is missing, so the export will use a generic file name and no title text.');
  if (plan.durationSec < 6) warnings.push('Very short duration; the promo may end before the hook lands.');
  if (plan.durationSec > 30) warnings.push('Unusually long duration for a short-form promo.');
  if (composition.layers.length === 0) warnings.push('Preview composition has no layers; the output may look empty.');

  const ready = blockers.length === 0;
  const exportKind = plan.audio ? 'Audio promo clip' : 'Silent canvas loop';
  const title = ready ? 'Ready to create MP4' : 'Needs attention before you create the MP4';
  const summary = ready
    ? `${exportKind} using ${plan.recipeName || 'the selected style'}.`
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
      { label: 'Assets', value: `Cover ${project.coverPath ? 'ready' : 'missing'} · Audio ${plan.audio ? (project.audioPath ? 'ready' : 'missing') : 'not needed'} · Output ${project.outputDir ? 'ready' : 'missing'}` },
      { label: 'Format', value: `${plan.width}×${plan.height} MP4 · ${plan.durationSec}s` },
      { label: 'Audio range', value: plan.audio ? formatRange(plan.audioStartSec, plan.audioEndSec) : 'Silent export' },
      { label: 'File name', value: plan.outputName },
    ],
  };
}
