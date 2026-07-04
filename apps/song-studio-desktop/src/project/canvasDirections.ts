import { parseTime } from '../lib/time';
import type { RenderRecipe } from '../render/types';
import { loopCoreForOutput, type ProjectOutput } from './types';
import { invalidateOutputRender } from './renderFreshness';

/**
 * Switch the creative direction for an existing Canvas output without turning a
 * style choice into a new Output or a duration reset. The selected recipe owns
 * the export-real look; the existing output owns identity, song-reference
 * context, and loop duration.
 */
export function applyCanvasDirectionPatch(output: ProjectOutput, recipe: RenderRecipe): ProjectOutput {
  const durationSec = parseTime(output.clipDuration) ?? recipe.defaultDurationSec;
  const next: ProjectOutput = {
    ...output,
    functionId: 'make_canvas',
    recipeId: recipe.id,
    selectedPromoDirectionId: null,
    clipStart: '0:00',
    loopCore: loopCoreForOutput('make_canvas', durationSec, output.loopCore),
    updatedAt: new Date().toISOString(),
  };
  return invalidateOutputRender(next);
}
