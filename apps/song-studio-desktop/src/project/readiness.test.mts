import assert from 'node:assert/strict';
import { deriveReleaseReadiness } from './readiness';
import { emptyOutput, emptyReleaseProject, type ProjectOutput, type ReleaseProject } from './types';

function project(patch: Partial<ReleaseProject> = {}): ReleaseProject {
  return { ...emptyReleaseProject(), ...patch };
}

function rendered(output: ProjectOutput): ProjectOutput {
  return { ...output, status: 'rendered', lastRender: { outputPath: '/tmp/out.mp4', bytes: 2048, renderedAt: '2026-01-01T00:00:00.000Z' } };
}

const empty = deriveReleaseReadiness(project());
assert.equal(empty.essentialsAdded, 0);
assert.equal(empty.nextAction.kind, 'add-song');

const songOnly = deriveReleaseReadiness(project({ audioPath: '/music/song.wav' }));
assert.equal(songOnly.essentialsAdded, 1);
assert.equal(songOnly.nextAction.kind, 'add-cover');

const readyNoOutputs = deriveReleaseReadiness(project({ audioPath: '/music/song.wav', coverPath: '/art/cover.png' }));
assert.equal(readyNoOutputs.essentialsAdded, 2);
assert.equal(readyNoOutputs.nextAction.kind, 'create-first-output');
assert.equal(readyNoOutputs.unstartedOutputTypes, 3);

const draftCanvas = emptyOutput('make_canvas', 'clean_canvas', 6, 'Canvas draft');
const withDraft = deriveReleaseReadiness(project({ audioPath: '/music/song.wav', coverPath: '/art/cover.png', outputs: [draftCanvas] }));
assert.equal(withDraft.draftOutputs, 1);
assert.equal(withDraft.outputTypes.find((type) => type.functionId === 'make_canvas')?.state, 'draft');
assert.equal(withDraft.nextAction.kind, 'continue-output');

const createdCanvas = rendered(draftCanvas);
const withRendered = deriveReleaseReadiness(project({ audioPath: '/music/song.wav', coverPath: '/art/cover.png', outputs: [createdCanvas] }));
assert.equal(withRendered.createdOutputs, 1);
assert.equal(withRendered.outputTypes.find((type) => type.functionId === 'make_canvas')?.state, 'created');
assert.equal(withRendered.nextAction.kind, 'create-output-type');

const errorOutput = { ...emptyOutput('make_hook_promo', 'vertical_promo', 15, 'Hook error'), status: 'error' as const };
const withError = deriveReleaseReadiness(project({ audioPath: '/music/song.wav', coverPath: '/art/cover.png', outputs: [createdCanvas, errorOutput] }));
assert.equal(withError.needsAttentionOutputs, 1);
assert.equal(withError.outputTypes.find((type) => type.functionId === 'make_hook_promo')?.state, 'needs-attention');
assert.equal(withError.nextAction.kind, 'fix-output');

const visualizer = rendered(emptyOutput('make_visualizer', 'neon_visualizer', 15, 'Visualizer'));
const secondCanvas = emptyOutput('make_canvas', 'clean_canvas', 6, 'Canvas variation');
const multiple = deriveReleaseReadiness(project({ audioPath: '/music/song.wav', coverPath: '/art/cover.png', outputs: [createdCanvas, secondCanvas, rendered(errorOutput), visualizer] }));
assert.equal(multiple.outputTypes.find((type) => type.functionId === 'make_canvas')?.outputs.length, 2);
assert.equal(multiple.unstartedOutputTypes, 0);
assert.equal(multiple.nextAction.kind, 'continue-output');

const allCreated = deriveReleaseReadiness(project({ audioPath: '/music/song.wav', coverPath: '/art/cover.png', outputs: [createdCanvas, rendered(errorOutput), visualizer] }));
assert.equal(allCreated.unstartedOutputTypes, 0);
assert.equal(allCreated.nextAction.kind, 'review-or-variant');

console.log('[readiness] PASS — essentials, output states, next actions, and multiple-output grouping verified.');
