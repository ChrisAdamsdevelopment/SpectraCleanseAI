import { getFunction, getRecipe } from './recipes';
import { getTemplate } from './templates';
import { parseTime, timestampStamp } from '../lib/time';
import type { SongProject } from '../project/types';

// Resolves a project into a human-readable plan + validation + a unique output
// filename, so the user understands exactly what will be created before rendering.
export interface RenderPlan {
  ok: boolean;
  errors: string[];
  functionLabel: string;
  recipeName: string;
  templateLabel: string;
  width: number;
  height: number;
  durationSec: number;
  audio: boolean;
  audioStartSec: number;
  audioEndSec: number;
  visualSummary: string;
  outputName: string;
}

export function buildRenderPlan(project: SongProject): RenderPlan {
  const errors: string[] = [];
  const fn = getFunction(project.functionId);
  const recipe = getRecipe(project.recipeId);
  if (!fn) errors.push('Pick what you want to make.');
  if (!recipe) errors.push('Pick a style.');
  const template = getTemplate(recipe?.visualTemplateId ?? 'cover_focus');

  if (!project.coverPath) errors.push('Select cover art.');
  const audio = Boolean(recipe?.audioRequired);
  if (audio && !project.audioPath) errors.push('This needs a song audio file.');
  if (!project.outputDir) errors.push('Choose an output folder.');

  const start = parseTime(project.clipStart);
  const durRaw = parseTime(project.clipDuration);
  let durationSec = recipe?.defaultDurationSec ?? 6;
  let audioStartSec = 0;
  if (audio) {
    if (start === null) errors.push('Clip start is not a valid time (use seconds or m:ss).');
    else if (start < 0) errors.push('Clip start cannot be negative.');
    else audioStartSec = start;
  }
  if (durRaw === null) errors.push('Clip duration is not a valid number.');
  else if (durRaw < 3 || durRaw > 60) errors.push('Clip duration must be between 3 and 60 seconds.');
  else durationSec = durRaw;

  const safeTitle = project.title.replace(/[^a-z0-9-_ ]/gi, '_').trim() || 'song';
  const tag = recipe?.id ?? fn?.id ?? 'render';
  const outputName = `${safeTitle}_${tag}_${timestampStamp()}.mp4`;

  const visualSummary = recipe
    ? `${template.label}: cover art center + ${recipe.backgroundStyle} background` +
      `${recipe.overlayStyle === 'waveform' ? ' + waveform' : ''}${project.title ? ' + title' : ''}`
    : '';

  return {
    ok: errors.length === 0,
    errors,
    functionLabel: fn?.label ?? '',
    recipeName: recipe?.name ?? '',
    templateLabel: template.label,
    width: recipe?.width ?? 1080,
    height: recipe?.height ?? 1920,
    durationSec,
    audio,
    audioStartSec,
    audioEndSec: audioStartSec + durationSec,
    visualSummary,
    outputName,
  };
}
