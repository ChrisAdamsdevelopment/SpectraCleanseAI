import assert from 'node:assert/strict';
import { CREATIVE_FUNCTIONS } from '../render/recipes';
import { deriveReleaseReadiness, effectiveOutputState, outputActionLabel } from './readiness';
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
assert.equal(readyNoOutputs.unstartedOutputTypes, readyNoOutputs.supportedOutputTypes);
assert.deepEqual(readyNoOutputs.outputTypes.map((type) => type.functionId).sort(), CREATIVE_FUNCTIONS.map((fn) => fn.id).sort());

const draftCanvas = emptyOutput('make_canvas', 'clean_canvas', 6, 'Canvas draft');
const withDraft = deriveReleaseReadiness(project({ audioPath: '/music/song.wav', coverPath: '/art/cover.png', outputs: [draftCanvas] }));
assert.equal(withDraft.draftOutputs, 1);
assert.equal(withDraft.outputTypes.find((type) => type.functionId === 'make_canvas')?.state, 'draft');
assert.equal(withDraft.nextAction.kind, 'continue-output');



const renderedWithoutArtifact = { ...emptyOutput('make_canvas', 'clean_canvas', 6, 'Rendered without artifact'), status: 'rendered' as const, lastRender: null };
const inconsistentRendered = deriveReleaseReadiness(project({ audioPath: '/music/song.wav', coverPath: '/art/cover.png', outputs: [renderedWithoutArtifact] }));
assert.equal(effectiveOutputState(renderedWithoutArtifact), 'draft');
assert.equal(inconsistentRendered.draftOutputs, 1);
assert.equal(inconsistentRendered.createdOutputs, 0);
assert.equal(inconsistentRendered.outputTypes.find((type) => type.functionId === 'make_canvas')?.state, 'draft');
assert.equal(inconsistentRendered.nextAction.kind, 'continue-output');
assert.equal(inconsistentRendered.nextAction.outputId, renderedWithoutArtifact.id);
assert.equal(outputActionLabel(renderedWithoutArtifact), 'Continue');

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



const mixedCreated = rendered(emptyOutput('make_canvas', 'clean_canvas', 6, 'Canvas created'));
const mixedDraft = emptyOutput('make_canvas', 'clean_canvas', 6, 'Canvas draft variant');
const mixedError = { ...emptyOutput('make_canvas', 'clean_canvas', 6, 'Canvas error variant'), status: 'error' as const };
const mixedType = deriveReleaseReadiness(project({ audioPath: '/music/song.wav', coverPath: '/art/cover.png', outputs: [mixedCreated, mixedDraft, mixedError] }));
const mixedCanvasType = mixedType.outputTypes.find((type) => type.functionId === 'make_canvas');
assert.equal(mixedCanvasType?.outputs.length, 3);
assert.equal(mixedCanvasType?.createdCount, 1);
assert.equal(mixedCanvasType?.draftCount, 1);
assert.equal(mixedCanvasType?.needsAttentionCount, 1);
assert.equal(mixedCanvasType?.state, 'needs-attention');
assert.equal(mixedType.nextAction.kind, 'fix-output');
assert.equal(mixedType.nextAction.outputId, mixedError.id);
assert.equal(outputActionLabel(mixedError), 'Fix Output');

const allCreated = deriveReleaseReadiness(project({ audioPath: '/music/song.wav', coverPath: '/art/cover.png', outputs: [createdCanvas, rendered(errorOutput), visualizer] }));
assert.equal(allCreated.unstartedOutputTypes, 0);
assert.equal(allCreated.nextAction.kind, 'review-or-variant');

console.log('[readiness] PASS — essentials, output states, next actions, and multiple-output grouping verified.');
