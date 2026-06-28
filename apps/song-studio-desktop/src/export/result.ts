import { formatTime } from '../lib/time';
import type { SongMoment, SongProject } from '../project/types';
import { getPromoDirectionCandidate } from '../promo/directions';
import type { RenderPlan } from '../render/plan';
import type { RenderResult } from '../render/types';

export interface ExportResultRow {
  label: string;
  value: string;
}

export interface ExportResultSummary {
  status: 'success' | 'failure';
  title: string;
  summary: string;
  rows: ExportResultRow[];
  nextAction: string;
  outputPath?: string;
  folderPath?: string;
  warnings: string[];
}

interface ExportResultInput {
  result: RenderResult;
  project: SongProject;
  plan: RenderPlan;
  selectedMoment: SongMoment | null;
}

function basename(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

function dirname(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx > 0 ? trimmed.slice(0, idx) : '';
}

function range(startSec: number, endSec: number): string {
  return `${formatTime(startSec)}–${formatTime(endSec)}`;
}

function momentValue(selectedMoment: SongMoment | null, plan: RenderPlan): string {
  if (selectedMoment) return `${selectedMoment.label} · ${range(selectedMoment.startSec, selectedMoment.endSec)}`;
  if (plan.audio) return `Manual clip · ${range(plan.audioStartSec, plan.audioEndSec)}`;
  return 'Silent loop';
}

function directionValue(project: SongProject, plan: RenderPlan): string {
  if (project.selectedPromoDirectionId) {
    return getPromoDirectionCandidate(project, project.selectedPromoDirectionId)?.label ?? 'Selected direction';
  }
  return plan.recipeName || 'Current style';
}

function errorSummary(error?: string): string {
  const message = (error || 'The MP4 was not created.').trim();
  if (/No such filter: '?drawtext'?/i.test(message)) return 'The local video tool could not add title text because a text filter is unavailable.';
  if (/ffmpeg/i.test(message)) return 'The local video tool stopped before creating the final MP4.';
  if (/permission|denied/i.test(message)) return 'Song Studio could not write to the selected output folder.';
  return message.split('\n')[0] || 'The MP4 was not created.';
}

export function buildExportResultSummary({ result, project, plan, selectedMoment }: ExportResultInput): ExportResultSummary {
  if (!result.ok) {
    return {
      status: 'failure',
      title: 'Something needs attention before the MP4 can be created',
      summary: errorSummary(result.error),
      nextAction: 'Fix the item above, then try Create MP4 again.',
      warnings: result.error ? [result.error] : [],
      rows: [
        { label: 'Attempted file', value: plan.outputName },
        { label: 'Format', value: `${plan.width}×${plan.height} MP4 · ${plan.durationSec}s` },
        { label: 'Song moment', value: momentValue(selectedMoment, plan) },
        { label: 'Direction', value: directionValue(project, plan) },
      ],
    };
  }

  const outputPath = result.outputPath;
  const folder = project.outputDir || (outputPath ? dirname(outputPath) : 'Selected output folder');
  const fileName = outputPath ? basename(outputPath) : plan.outputName;
  const size = typeof result.bytes === 'number' ? `${Math.max(1, Math.round(result.bytes / 1024))} KB` : 'Created';

  return {
    status: 'success',
    title: 'Your MP4 is ready',
    summary: 'Song Studio saved your promo video. Review it with sound on, then make another when you are ready.',
    nextAction: 'Review your video or copy the saved path.',
    outputPath,
    folderPath: folder,
    warnings: [],
    rows: [
      { label: 'File', value: fileName },
      { label: 'Save folder', value: folder || 'Selected save folder' },
      { label: 'Duration', value: `${plan.durationSec}s` },
      { label: 'Format', value: `${plan.width}×${plan.height} MP4` },
      { label: 'Song moment', value: momentValue(selectedMoment, plan) },
      { label: 'Direction', value: directionValue(project, plan) },
      { label: 'Size', value: size },
    ],
  };
}
