import assert from 'node:assert/strict';
import { buildRenderPlan } from '../render/plan';
import { motionIntensityToZoom, recipeToComposition } from '../render/composition';
import { buildFfmpegArgs } from '../render/ffmpegArgs';
import { getRecipe } from '../render/recipes';
import { getTemplate } from '../render/templates';
import { normalizeReleaseProject } from './storage';
import { emptyOutput, loopCoreForOutput, mergeProjectView, type ReleaseProject } from './types';

function projectWith(output = emptyOutput('make_canvas', 'clean_canvas', 7, 'Canvas')): ReleaseProject {
  return {
    schemaVersion: 4,
    title: 'Integrity',
    artist: 'Tester',
    audioPath: '/tmp/song.m4a',
    coverPath: '/tmp/cover.png',
    outputDir: '/tmp/out',
    songAnalysis: null,
    assets: [],
    directionCues: [],
    outputs: [output],
    activeOutputId: output.id,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const canvas = emptyOutput('make_canvas', 'clean_canvas', 7, 'Canvas');
const editedCanvas = { ...canvas, clipDuration: '8', loopCore: loopCoreForOutput(canvas.functionId, 8, canvas.loopCore) };
assert.equal(editedCanvas.loopCore?.loopDurationSec, 8);
assert.equal(buildRenderPlan(mergeProjectView(projectWith(editedCanvas), editedCanvas)).durationSec, 8);

const drifted = normalizeReleaseProject({
  ...projectWith({ ...canvas, clipDuration: '8', loopCore: { ...canvas.loopCore!, loopDurationSec: 7 } }),
});
const reopened = drifted.outputs[0];
assert.equal(reopened.clipDuration, '8');
assert.equal(reopened.loopCore?.loopDurationSec, 8);
assert.equal(buildRenderPlan(mergeProjectView(drifted, reopened)).durationSec, 8);

const promo = emptyOutput('make_hook_promo', 'vertical_promo', 15, 'Promo');
assert.equal(loopCoreForOutput(promo.functionId, 15, canvas.loopCore), null);
assert.equal(loopCoreForOutput('make_canvas', 6, promo.loopCore)?.loopDurationSec, 6);

const recipe = getRecipe('clean_canvas')!;
const template = getTemplate(recipe.visualTemplateId);
const baseZoom = template.bgZoom ?? (recipe.motionStyle === 'zoom' ? 0.2 : 0);
assert.equal(motionIntensityToZoom(baseZoom, 0.5), baseZoom);
const defaultComp = recipeToComposition(recipe, template, { title: 'Integrity', motionIntensity: 0.5 });
const highComp = recipeToComposition(recipe, template, { title: 'Integrity', motionIntensity: 1 });
const defaultArgs = buildFfmpegArgs(defaultComp, { imagePath: '/tmp/cover.png', outputPath: '/tmp/default.mp4', durationSec: 7 });
const highArgs = buildFfmpegArgs(highComp, { imagePath: '/tmp/cover.png', outputPath: '/tmp/high.mp4', durationSec: 7 });
const defaultFilter = defaultArgs[defaultArgs.indexOf('-filter_complex') + 1];
const highFilter = highArgs[highArgs.indexOf('-filter_complex') + 1];
assert.notEqual(defaultFilter, highFilter);

console.log('[loop-core-integrity] PASS — duration sync, save/reload normalization, output transitions, and zoom render args verified.');
