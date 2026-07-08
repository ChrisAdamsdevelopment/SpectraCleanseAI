import assert from 'node:assert/strict';
import { getFunction, getRecipe, recipesForFunction } from './recipes';
import { getTemplate } from './templates';
import { recipeToComposition, getLayer } from './composition';
import type { BackgroundLayer, CoverLayer, TitleLayer, EffectLayer } from './types';
import { emptyOutput, type ProjectOutput } from '../project/types';
import { applyCanvasDirectionPatch } from '../project/canvasDirections';
import { applySuccessfulRender } from '../project/renderFreshness';
import { effectiveOutputState } from '../project/readiness';
import { normalizeReleaseProject } from '../project/storage';

const canvasFunction = getFunction('make_canvas')!;
const canvasRecipes = recipesForFunction(canvasFunction);
assert.deepEqual(canvasRecipes.map((r) => r.id), ['clean_canvas', 'cinematic_canvas', 'immersive_canvas']);

for (const fnId of ['make_hook_promo', 'make_visualizer']) {
  const fn = getFunction(fnId)!;
  assert.equal(recipesForFunction(fn).some((r) => r.category === 'canvas'), false, `${fnId} should not expose Canvas-only recipes`);
}

const signatures = canvasRecipes.map((recipe) => {
  const comp = recipeToComposition(recipe, getTemplate(recipe.visualTemplateId), { title: 'Direction Test', motionIntensity: 0.5 });
  const bg = getLayer<BackgroundLayer>(comp, 'background')!;
  const cover = getLayer<CoverLayer>(comp, 'cover_art')!;
  const title = getLayer<TitleLayer>(comp, 'title_text')!;
  const effect = getLayer<EffectLayer>(comp, 'effect_overlay')!;
  return JSON.stringify({
    coverScale: cover.scale,
    coverY: cover.y,
    coverShadow: cover.shadow,
    bgBlur: bg.blur,
    bgBrightness: bg.brightness,
    bgSaturation: bg.saturation,
    bgContrast: bg.contrast,
    bgZoom: bg.zoom,
    vignette: effect.visible && effect.vignette,
    titleSize: title.size,
    titleY: title.y,
    titleStroke: title.stroke,
    titleShadow: title.shadow,
  });
});
assert.equal(new Set(signatures).size, canvasRecipes.length, 'Canvas directions must differ by render-backed composition values');

const rendered: ProjectOutput = applySuccessfulRender({
  ...emptyOutput('make_canvas', 'cinematic_canvas', 7, 'Canvas'),
  id: 'canvas-output',
  clipStart: '0:42',
  clipDuration: '9',
  selectedMomentId: 'hook-a',
}, { outputPath: '/tmp/canvas.mp4', bytes: 12, renderedAt: '2026-07-04T00:00:00.000Z' });
const noOp = applyCanvasDirectionPatch(rendered, getRecipe('cinematic_canvas')!);
assert.equal(noOp.recipeId, 'cinematic_canvas');
assert.equal(noOp.status, 'rendered');
assert.equal(effectiveOutputState(noOp), 'created');
assert.equal(noOp.lastRender, rendered.lastRender);
assert.equal(noOp.renderRevision, rendered.renderRevision);
assert.equal(noOp.selectedMomentId, 'hook-a');
assert.equal(noOp.clipStart, '0:42');

const switched = applyCanvasDirectionPatch(rendered, getRecipe('immersive_canvas')!);
assert.equal(switched.id, rendered.id);
assert.equal(switched.recipeId, 'immersive_canvas');
assert.equal(switched.clipDuration, '9');
assert.equal(switched.clipStart, '0:42');
assert.equal(switched.loopCore?.loopDurationSec, 9);
assert.equal(switched.selectedMomentId, 'hook-a');
assert.equal(switched.status, 'draft');
assert.equal(switched.lastRender, null);
assert.equal(switched.renderRevision, rendered.renderRevision + 1);

const reopened = normalizeReleaseProject({
  schemaVersion: 3,
  title: 'Saved Song',
  outputs: [switched],
  activeOutputId: switched.id,
});
assert.equal(reopened.outputs[0].recipeId, 'immersive_canvas');
assert.equal(reopened.outputs[0].clipDuration, '9');
assert.equal(reopened.outputs[0].clipStart, '0:42');
assert.equal(reopened.outputs[0].selectedMomentId, 'hook-a');
assert.equal(reopened.outputs[0].loopCore?.loopDurationSec, 9);

console.log('[canvas-directions] PASS — Canvas direction availability, output-type safety, render-backed distinctness, state preservation, no-op safety, render freshness, and persistence verified.');
