import type { SongMoment, SongProject } from '../project/types';
import type { CreativeFunction, RenderRecipe } from '../render/types';
import { CREATIVE_FUNCTIONS, RECIPES, getFunction, getRecipe } from '../render/recipes';
import { parseTime } from '../lib/time';

export interface PromoDirectionCandidate {
  id: string;
  label: string;
  purpose: string;
  functionId: string;
  recipeId: string;
  reason: string;
  fit: number;
  warnings: string[];
  source: 'deterministic-v1';
  momentId?: string;
  clipStart?: string;
  clipDuration?: string;
}

interface DirectionInput {
  project: SongProject;
  selectedMoment: SongMoment | null;
}

const clampFit = (value: number) => Math.max(0, Math.min(1, value));

function candidateFor(
  recipe: RenderRecipe,
  fn: CreativeFunction,
  input: DirectionInput,
  label: string,
  purpose: string,
  baseFit: number,
  reasonParts: string[],
): PromoDirectionCandidate {
  const { project, selectedMoment } = input;
  const warnings: string[] = [];
  let fit = baseFit;

  if (recipe.audioRequired && !project.audioPath) { warnings.push('Needs song audio before it can render.'); fit -= 0.35; }
  if (!project.coverPath) { warnings.push('Needs cover art for the current templates.'); fit -= 0.25; }
  if (recipe.audioRequired && selectedMoment) fit += 0.12;
  if (!recipe.audioRequired && selectedMoment) fit -= 0.05;
  if (project.functionId === fn.id) fit += 0.05;
  if (project.recipeId === recipe.id) fit += 0.04;

  if (selectedMoment && recipe.audioRequired) {
    const duration = selectedMoment.durationSec;
    if (duration < 8) warnings.push('Selected moment is very short; consider a longer moment for this direction.');
    if (duration > 30) warnings.push('Selected moment is longer than a typical short-form hook.');
    if (duration >= 10 && duration <= 20) fit += 0.08;
  }

  return {
    id: `${fn.id}:${recipe.id}${selectedMoment ? `:${selectedMoment.id}` : ''}`,
    label,
    purpose,
    functionId: fn.id,
    recipeId: recipe.id,
    reason: reasonParts.join(' '),
    fit: clampFit(fit),
    warnings,
    source: 'deterministic-v1',
    momentId: selectedMoment?.id,
    clipStart: selectedMoment ? String(selectedMoment.startSec) : undefined,
    clipDuration: selectedMoment ? String(selectedMoment.durationSec) : undefined,
  };
}

function byId<T extends { id: string }>(items: T[], id: string): T {
  const item = items.find((i) => i.id === id);
  if (!item) throw new Error(`Missing built-in direction dependency: ${id}`);
  return item;
}

export function getSelectedSongMoment(project: SongProject): SongMoment | null {
  if (!project.songAnalysis || !project.selectedMomentId) return null;
  return project.songAnalysis.moments.find((m) => m.id === project.selectedMomentId) ?? null;
}

export function buildPromoDirectionCandidates(project: SongProject): PromoDirectionCandidate[] {
  const selectedMoment = getSelectedSongMoment(project);
  const input = { project, selectedMoment };
  const hasMomentLikeClip = parseTime(project.clipDuration) !== null && parseTime(project.clipDuration)! >= 3;

  const hookFn = byId(CREATIVE_FUNCTIONS, 'make_hook_promo');
  const visualizerFn = byId(CREATIVE_FUNCTIONS, 'make_visualizer');
  const canvasFn = byId(CREATIVE_FUNCTIONS, 'make_canvas');
  const cleanHook = byId(RECIPES, 'vertical_promo');
  const darkHook = byId(RECIPES, 'dark_street_hook');
  const neon = byId(RECIPES, 'neon_visualizer');
  const canvas = byId(RECIPES, 'clean_canvas');

  const momentCopy = selectedMoment
    ? `Uses “${selectedMoment.label}” (${Math.round(selectedMoment.durationSec)}s) as the promo section.`
    : hasMomentLikeClip
      ? 'Uses the current clip start and duration until a suggested song moment is selected.'
      : 'Pick a song moment for a stronger audio-led recommendation.';

  const candidates = [
    candidateFor(cleanHook, hookFn, input, 'Clean moment promo', 'Turn the selected song moment into a clear vertical hook clip.', 0.72, [momentCopy, 'Clean cover focus and waveform fit most release posts.']),
    candidateFor(darkHook, hookFn, input, 'Darker hook treatment', 'Audition the same moment with a higher-contrast promo recipe.', 0.62, [momentCopy, 'Useful when the cover art or track needs a more intense first impression.']),
    candidateFor(neon, visualizerFn, input, 'Visualizer preview', 'Use the song audio and cover art as a simple waveform-led visualizer.', 0.56, [momentCopy, 'Best when motion around the audio matters more than a minimal cover layout.']),
    candidateFor(canvas, canvasFn, input, 'Silent canvas loop', 'Create a short cover-art loop as a non-audio fallback.', project.audioPath ? 0.42 : 0.58, ['Does not use the song audio.', project.coverPath ? 'Good fallback when you only need a cover-focused loop.' : 'Add cover art before rendering this direction.']),
  ];

  return candidates.sort((a, b) => b.fit - a.fit).slice(0, 4);
}

export function getPromoDirectionCandidate(project: SongProject, id: string): PromoDirectionCandidate | undefined {
  return buildPromoDirectionCandidates(project).find((candidate) => candidate.id === id);
}

export function promoDirectionRecipeLabel(candidate: PromoDirectionCandidate): string {
  const fn = getFunction(candidate.functionId);
  const recipe = getRecipe(candidate.recipeId);
  return [fn?.label, recipe?.name].filter(Boolean).join(' · ');
}
