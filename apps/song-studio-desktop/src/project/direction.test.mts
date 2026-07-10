import assert from 'node:assert/strict';
import { overlapWindow, resolveDirectedVisualForOutput, directedVisualsForOutput, isDirectableOutputType } from './direction';
import { buildFfmpegArgs } from '../render/ffmpegArgs';
import { recipeToComposition } from '../render/composition';
import { getRecipe } from '../render/recipes';
import { getTemplate } from '../render/templates';
import { normalizeReleaseProject } from './storage';
import { emptyOutput, emptyReleaseProject, type ProjectAsset, type ProjectOutput, type ReleaseProject } from './types';

// ── Windowing: song-relative cue → output-local overlap ─────────────────────
// Output clip window [10, 20] (start 10s, duration 10s).
assert.deepEqual(overlapWindow(12, 18, 10, 10), { startLocalSec: 2, endLocalSec: 8 }, 'full overlap inside');
assert.deepEqual(overlapWindow(5, 14, 10, 10), { startLocalSec: 0, endLocalSec: 4 }, 'partial overlap at start');
assert.deepEqual(overlapWindow(16, 25, 10, 10), { startLocalSec: 6, endLocalSec: 10 }, 'partial overlap at end');
assert.deepEqual(overlapWindow(8, 22, 10, 10), { startLocalSec: 0, endLocalSec: 10 }, 'cue spans whole clip');
assert.equal(overlapWindow(0, 9, 10, 10), null, 'entirely before clip');
assert.equal(overlapWindow(21, 30, 10, 10), null, 'entirely after clip');
assert.equal(overlapWindow(10, 10, 10, 10), null, 'zero-length');
assert.equal(overlapWindow(0, 10, 10, 10), null, 'edge-touching at start is not overlap');
assert.equal(overlapWindow(20, 25, 10, 10), null, 'edge-touching at end is not overlap');

// ── Resolution against an output (asset lookup + windowing + reasons) ───────
const asset: ProjectAsset = { id: 'a1', role: 'artist-photo', path: '/tmp/artist.png', label: 'Artist' };
function projectWithCue(startSec: number, endSec: number, assets: ProjectAsset[] = [asset]): ReleaseProject {
  return { ...emptyReleaseProject(), assets, directionCues: [{ id: 'c1', assetId: 'a1', startSec, endSec }] };
}
const audioOut: ProjectOutput = { ...emptyOutput('make_hook_promo', 'vertical_promo', 10, 'Teaser'), clipStart: '0:10', clipDuration: '10' };

const okRes = resolveDirectedVisualForOutput(projectWithCue(12, 18), audioOut);
assert.equal(okRes.status, 'ok');
assert.deepEqual(okRes.window, { imagePath: '/tmp/artist.png', startLocalSec: 2, endLocalSec: 8 });

// Same stored cue windowed against a DIFFERENT output — no duplicated decision.
const otherOut: ProjectOutput = { ...emptyOutput('make_hook_promo', 'vertical_promo', 6, 'Teaser 2'), clipStart: '0:00', clipDuration: '6' };
assert.equal(resolveDirectedVisualForOutput(projectWithCue(12, 18), otherOut).status, 'no-overlap', 'cue outside this output window');
assert.equal(resolveDirectedVisualForOutput(projectWithCue(2, 5), otherOut).status, 'ok', 'same cue shape, overlapping output');

assert.equal(resolveDirectedVisualForOutput(emptyReleaseProject(), audioOut).status, 'no-cue');
assert.equal(resolveDirectedVisualForOutput(projectWithCue(12, 18, []), audioOut).status, 'no-asset', 'cue asset removed');

// ── VIDEO-002 v1 RUNTIME BOUNDARY: audio teaser (hook promo) ONLY ───────────
assert.equal(isDirectableOutputType('make_hook_promo'), true, 'audio teaser is directable');
assert.equal(isDirectableOutputType('make_visualizer'), false, 'visualizer is NOT directable in v1');
assert.equal(isDirectableOutputType('make_canvas'), false, 'canvas is NOT directable in v1');

const cueProject = projectWithCue(12, 18); // overlaps a [10,20] clip window
const teaser: ProjectOutput = { ...emptyOutput('make_hook_promo', 'vertical_promo', 10, 'Teaser'), clipStart: '0:10', clipDuration: '10' };
const visualizer: ProjectOutput = { ...emptyOutput('make_visualizer', 'neon_visualizer', 10, 'Visualizer'), clipStart: '0:10', clipDuration: '10' };
const canvasOut: ProjectOutput = { ...emptyOutput('make_canvas', 'clean_canvas', 10, 'Canvas'), clipStart: '0:10', clipDuration: '10' };

assert.equal(directedVisualsForOutput(cueProject, teaser).length, 1, 'audio teaser consumes the direction');
assert.deepEqual(directedVisualsForOutput(cueProject, teaser)[0], { imagePath: '/tmp/artist.png', startLocalSec: 2, endLocalSec: 8 });
assert.deepEqual(directedVisualsForOutput(cueProject, visualizer), [], 'visualizer does NOT consume the direction in v1');
assert.deepEqual(directedVisualsForOutput(cueProject, canvasOut), [], 'canvas does NOT consume the direction in v1');
// The general windowing stays reusable — only the type gate withholds it — so
// a future story can widen the boundary without re-deriving overlap logic.
assert.equal(resolveDirectedVisualForOutput(cueProject, visualizer).status, 'ok', 'windowing remains general/reusable across output types');

// ── Persistence / normalization (save-reload round-trip + backward compat) ──
const oldProjectNoField = normalizeReleaseProject({
  outputs: [{ functionId: 'make_hook_promo', recipeId: 'vertical_promo', clipDuration: '10' }],
});
assert.deepEqual(oldProjectNoField.directionCues, [], 'old project with no directionCues normalizes to []');
assert.equal(oldProjectNoField.schemaVersion, 4);

const roundTrip = normalizeReleaseProject(JSON.parse(JSON.stringify(projectWithCue(12, 18))));
assert.equal(roundTrip.directionCues.length, 1);
assert.deepEqual(roundTrip.directionCues[0], { id: 'c1', assetId: 'a1', startSec: 12, endSec: 18 });

// Dangling cue (asset absent) and invalid spans are dropped on load.
const dangling = normalizeReleaseProject({ ...projectWithCue(12, 18, []), assets: [] });
assert.deepEqual(dangling.directionCues, [], 'cue referencing a missing asset is dropped');
const invalidSpan = normalizeReleaseProject({ ...emptyReleaseProject(), assets: [asset], directionCues: [{ id: 'c', assetId: 'a1', startSec: 9, endSec: 9 }] });
assert.deepEqual(invalidSpan.directionCues, [], 'zero-length cue is dropped');

// ── Causality at the FFmpeg-args layer ──────────────────────────────────────
const recipe = getRecipe('vertical_promo')!;
const comp = recipeToComposition(recipe, getTemplate(recipe.visualTemplateId), { title: 'Proof' });
const baseInputs = { imagePath: '/tmp/cover.png', audioPath: '/tmp/tone.m4a', outputPath: '/tmp/o.mp4', durationSec: 10, audioStartSec: 5 };

const baseline = buildFfmpegArgs(comp, baseInputs);
const baselineEmpty = buildFfmpegArgs(comp, { ...baseInputs, directedVisuals: [] });
assert.deepEqual(baselineEmpty, baseline, 'no directed visuals = byte-identical to baseline args');
const baseFilter = baseline[baseline.indexOf('-filter_complex') + 1];
assert.ok(!baseFilter.includes('enable='), 'baseline has no time-gating');

const directed = buildFfmpegArgs(comp, { ...baseInputs, directedVisuals: [{ imagePath: '/tmp/artist.png', startSec: 2, endSec: 6 }] });
assert.ok(directed.includes('/tmp/artist.png'), 'directed asset added as an input');
const directedFilter = directed[directed.indexOf('-filter_complex') + 1];
assert.ok(directedFilter.includes("enable='between(t,2.000,6.000)'"), 'gated overlay for the local window');
assert.ok(directedFilter.includes('[dprimary0]'), 'directed composite feeds the primary chain');

// Moving the direction changes the emitted timing.
const moved = buildFfmpegArgs(comp, { ...baseInputs, directedVisuals: [{ imagePath: '/tmp/artist.png', startSec: 4, endSec: 8 }] });
const movedFilter = moved[moved.indexOf('-filter_complex') + 1];
assert.notEqual(movedFilter, directedFilter, 'moving the direction changes the args');
assert.ok(movedFilter.includes("enable='between(t,4.000,8.000)'"));

// Waveform + title stay ABOVE the directed visual: use the visualizer recipe
// (which has a waveform) with a font so a title is drawn, and confirm both
// overlay the directed primary rather than the other way around.
const vizRecipe = getRecipe('neon_visualizer')!;
const vizComp = recipeToComposition(vizRecipe, getTemplate(vizRecipe.visualTemplateId), { title: 'Proof' });
const vizArgs = buildFfmpegArgs(vizComp, { ...baseInputs, directedVisuals: [{ imagePath: '/tmp/artist.png', startSec: 2, endSec: 6 }] }, { fontPath: '/tmp/font.ttf' });
const vizFilter = vizArgs[vizArgs.indexOf('-filter_complex') + 1];
assert.ok(vizFilter.indexOf('[dprimary0]') < vizFilter.indexOf('showwaves'), 'waveform is composited after (above) the directed visual');
assert.ok(vizFilter.indexOf('[dprimary0]') < vizFilter.indexOf('drawtext'), 'title is drawn after (above) the directed visual');

console.log('[direction] PASS — windowing, resolution reasons, persistence/back-compat, and FFmpeg causality verified.');
