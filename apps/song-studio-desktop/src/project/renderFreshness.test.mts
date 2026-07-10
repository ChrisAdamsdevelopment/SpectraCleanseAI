import assert from 'node:assert/strict';
import { effectiveOutputState } from './readiness';
import { applyFailedRender, applySuccessfulRender, canApplyRenderAttempt, invalidateOutputRender, invalidateOutputsForSharedInput } from './renderFreshness';
import { emptyOutput, type ProjectOutput } from './types';

function rendered(output: ProjectOutput): ProjectOutput {
  return applySuccessfulRender(output, { outputPath: '/tmp/current.mp4', bytes: 4096, renderedAt: '2026-01-01T00:00:00.000Z' });
}

const created = rendered(emptyOutput('make_hook_promo', 'vertical_promo', 15, 'Hook promo'));
assert.equal(effectiveOutputState(created), 'created');

const edited = invalidateOutputRender(created);
assert.equal(effectiveOutputState(edited), 'draft');
assert.equal(edited.lastRender, null);
assert.equal(edited.renderRevision, created.renderRevision + 1);
assert.equal(canApplyRenderAttempt(created, { outputId: created.id, renderRevision: created.renderRevision }), true);
assert.equal(canApplyRenderAttempt(edited, { outputId: created.id, renderRevision: created.renderRevision }), false);

const rerendered = applySuccessfulRender(edited, { outputPath: '/tmp/new.mp4', bytes: 8192, renderedAt: '2026-01-02T00:00:00.000Z' });
assert.equal(effectiveOutputState(rerendered), 'created');
assert.equal(rerendered.lastRender?.outputPath, '/tmp/new.mp4');

const failed = applyFailedRender(created);
assert.equal(effectiveOutputState(failed), 'needs-attention');
assert.equal(failed.lastRender?.outputPath, '/tmp/current.mp4');

const nonRenderPatch = { ...created, name: 'Renamed only' };
assert.equal(effectiveOutputState(nonRenderPatch), 'created');
assert.equal(nonRenderPatch.lastRender?.outputPath, '/tmp/current.mp4');


const outputA = rendered(emptyOutput('make_hook_promo', 'vertical_promo', 15, 'Output A'));
const outputB = rendered(emptyOutput('make_visualizer', 'neon_visualizer', 15, 'Output B'));
const attemptA = { outputId: outputA.id, renderRevision: outputA.renderRevision };
const editedA = { ...invalidateOutputRender(outputA), clipStart: '0:12' };
const staleCompletionA = canApplyRenderAttempt(editedA, attemptA) ? applySuccessfulRender(editedA, { outputPath: '/tmp/stale.mp4', renderedAt: '2026-01-03T00:00:00.000Z' }) : editedA;
assert.equal(staleCompletionA.clipStart, '0:12');
assert.equal(effectiveOutputState(staleCompletionA), 'draft');
assert.equal(canApplyRenderAttempt(outputB, attemptA), false);
const normalCompletionA = canApplyRenderAttempt(outputA, attemptA) ? applySuccessfulRender(outputA, { outputPath: '/tmp/fresh.mp4', renderedAt: '2026-01-03T00:00:00.000Z' }) : outputA;
assert.equal(effectiveOutputState(normalCompletionA), 'created');
assert.equal(normalCompletionA.lastRender?.outputPath, '/tmp/fresh.mp4');
const failedCompletionA = canApplyRenderAttempt(outputA, attemptA) ? applyFailedRender(outputA) : outputA;
assert.equal(effectiveOutputState(failedCompletionA), 'needs-attention');

const canvas = rendered(emptyOutput('make_canvas', 'clean_canvas', 6, 'Canvas'));
const promo = rendered(emptyOutput('make_hook_promo', 'vertical_promo', 15, 'Promo'));
const legacy = rendered(emptyOutput('legacy_saved_output', 'legacy_recipe', 10, 'Legacy'));

const afterCover = invalidateOutputsForSharedInput([canvas, promo, legacy], 'coverPath');
assert.equal(effectiveOutputState(afterCover[0]), 'draft');
assert.equal(effectiveOutputState(afterCover[1]), 'draft');
assert.equal(effectiveOutputState(afterCover[2]), 'created');

const afterAudio = invalidateOutputsForSharedInput([canvas, promo, legacy], 'audioPath');
assert.equal(effectiveOutputState(afterAudio[0]), 'created');
assert.equal(effectiveOutputState(afterAudio[1]), 'draft');
assert.equal(effectiveOutputState(afterAudio[2]), 'created');

const afterOutputDir = invalidateOutputsForSharedInput([canvas, promo, legacy], 'outputDir');
assert.equal(effectiveOutputState(afterOutputDir[0]), 'created');
assert.equal(effectiveOutputState(afterOutputDir[1]), 'created');
assert.equal(effectiveOutputState(afterOutputDir[2]), 'created');

const afterSongAnalysis = invalidateOutputsForSharedInput([canvas, promo, legacy], 'songAnalysis');
assert.equal(effectiveOutputState(afterSongAnalysis[0]), 'created');
assert.equal(effectiveOutputState(afterSongAnalysis[1]), 'created');
assert.equal(effectiveOutputState(afterSongAnalysis[2]), 'created');

// VIDEO-002 v1 boundary: a direction change invalidates ONLY the audio teaser
// (hook promo). Canvas and the visualizer keep their render state.
const visualizerFresh = rendered(emptyOutput('make_visualizer', 'neon_visualizer', 15, 'Visualizer'));
const afterDirection = invalidateOutputsForSharedInput([canvas, promo, visualizerFresh, legacy], 'directionCues');
assert.equal(effectiveOutputState(afterDirection[0]), 'created', 'canvas untouched by direction change');
assert.equal(effectiveOutputState(afterDirection[1]), 'draft', 'audio teaser invalidated by direction change');
assert.equal(effectiveOutputState(afterDirection[2]), 'created', 'visualizer untouched by direction change');
assert.equal(effectiveOutputState(afterDirection[3]), 'created', 'unknown/legacy output untouched');

console.log('[render-freshness] PASS — render invalidation, success/failure, non-render changes, shared dependency scope, VIDEO-002 teaser-only direction boundary, and legacy safety verified.');
