// Pure Director state transitions (DEC-003 §10). UI components call these; they
// never touch IO. Every transition preserves the invariants: accepted scenes
// elsewhere are untouched, takes keep their compiled snapshots, and the
// workprint goes stale exactly when its included accepted-take set changes.

import {
  makeTake, refreshEntityIdentity, assemblySignature, orderedScenes, computeIdentityFingerprint,
  type DirectorState, type DirectorEntity, type GenerationTake, type RepairDirection, type ScenePlan,
} from './model';
import type { GenerationPacket } from './compile';

function replaceScene(state: DirectorState, scene: ScenePlan): DirectorState {
  return { ...state, scenes: state.scenes.map((s) => (s.id === scene.id ? scene : s)) };
}
function replaceTake(state: DirectorState, take: GenerationTake): DirectorState {
  return { ...state, takes: state.takes.map((t) => (t.id === take.id ? take : t)) };
}

/** The workprint is stale when the assembly SIGNATURE (accepted takes + scene
 * timings + short-clip policies + aspect, §H7) differs from the built one, or
 * when it was never built while accepted takes exist. */
export function recomputeWorkprintStale(state: DirectorState): DirectorState {
  const acceptedCount = state.scenes.filter((s) => s.acceptedTakeId).length;
  const sig = assemblySignature(state);
  const stale = state.workprint.lastBuiltAt === null ? acceptedCount > 0 : sig !== state.workprint.builtSignature;
  return { ...state, workprint: { ...state.workprint, stale } };
}

/** Create a take from a compiled packet (status packet-built). When the packet
 * was compiled with attemptId = the intended take id, pass it as `takeId` so
 * the persisted take and the packet's return contract share one identity. */
export function addTakeFromPacket(state: DirectorState, scene: ScenePlan, packet: GenerationPacket, provider: string, parentTakeId: string | null = null, takeId?: string): { state: DirectorState; take: GenerationTake } {
  const take = makeTake(scene, {
    promptDigest: packet.promptDigest, recipe: packet.recipe,
    referenceFiles: packet.references.map((r) => r.fileName),
    sceneStartSec: packet.timing.sceneStartSec, sceneEndSec: packet.timing.sceneEndSec,
    aspect: packet.aspect, resolution: packet.resolution, durationSec: packet.timing.durationSec,
  }, provider, packet.entityFingerprints, parentTakeId, takeId ?? undefined);
  const nextScene: ScenePlan = { ...scene, status: 'awaiting-result' };
  return { state: replaceScene({ ...state, takes: [...state.takes, take] }, nextScene), take };
}

/** Mark a take's provider status (submitted/polling/failed/etc). */
export function setTakeStatus(state: DirectorState, takeId: string, status: GenerationTake['status'], patch: Partial<GenerationTake> = {}): DirectorState {
  const take = state.takes.find((t) => t.id === takeId);
  if (!take) return state;
  return replaceTake(state, { ...take, status, ...patch });
}

// ── Provider job lifecycle (§B). The providerJob record is persisted so a
// pending job survives close/reopen and can be resumed. ─────────────────────

/** Record a submission: persist the job id IMMEDIATELY (resume-critical). */
export function applyProviderSubmit(state: DirectorState, takeId: string, args: { providerId: string; modelId: string | null; jobId: string | null; phase: 'submitted' | 'running' | 'succeeded' | 'failed'; parentJobId?: string | null; error?: string | null }): DirectorState {
  const take = state.takes.find((t) => t.id === takeId);
  if (!take) return state;
  const at = new Date().toISOString();
  const providerJob = {
    ...take.providerJob,
    providerId: args.providerId, modelId: args.modelId, jobId: args.jobId,
    phase: args.phase, submittedAt: take.providerJob.submittedAt ?? at,
    parentJobId: args.parentJobId ?? take.providerJob.parentJobId,
    error: args.error ?? null,
  };
  const status: GenerationTake['status'] = args.phase === 'failed' ? 'failed' : args.phase === 'succeeded' ? 'succeeded' : 'submitted';
  return replaceTake(state, { ...take, provider: args.providerId, model: args.modelId, submittedAt: providerJob.submittedAt, providerJob, status, error: args.error ?? take.error });
}

/** Record a poll result (phase transition + timestamps + errors persisted). */
export function applyProviderPoll(state: DirectorState, takeId: string, poll: { phase: string; error?: string; resultRef?: string | null }): DirectorState {
  const take = state.takes.find((t) => t.id === takeId);
  if (!take) return state;
  const at = new Date().toISOString();
  const running = poll.phase === 'running' || poll.phase === 'submitted';
  const providerJob = {
    ...take.providerJob,
    phase: (poll.phase === 'succeeded' ? 'succeeded' : poll.phase === 'failed' ? 'failed' : 'running') as GenerationTake['providerJob']['phase'],
    lastPolledAt: at,
    completedAt: running ? take.providerJob.completedAt : at,
    resultRef: poll.resultRef ?? take.providerJob.resultRef,
    error: poll.error ?? (poll.phase === 'failed' ? 'provider error' : take.providerJob.error),
  };
  const status: GenerationTake['status'] = poll.phase === 'succeeded' ? 'succeeded' : poll.phase === 'failed' ? 'failed' : 'polling';
  return replaceTake(state, { ...take, providerJob, status, error: providerJob.error });
}

/** A take whose live job is pending and can be resumed after reopen. */
export function resumableTakes(state: DirectorState): GenerationTake[] {
  return state.takes.filter((t) => t.providerJob.jobId && (t.providerJob.phase === 'submitted' || t.providerJob.phase === 'running') && !t.assetId);
}

/** Bind a downloaded/decoded MP4 result to its take and move the scene into
 * review. Idempotent: re-binding the same asset is safe (duplicate-poll safety). */
export function applyProviderResult(state: DirectorState, takeId: string, assetId: string, localResultPath: string): DirectorState {
  const take = state.takes.find((t) => t.id === takeId);
  if (!take) return state;
  if (take.assetId === assetId && take.providerJob.phase === 'succeeded') return state; // already bound
  const providerJob = { ...take.providerJob, phase: 'succeeded' as const, completedAt: take.providerJob.completedAt ?? new Date().toISOString(), localResultPath, error: null };
  const bound = { ...take, providerJob };
  const s = replaceTake(state, bound);
  return bindResultToTake(s, takeId, assetId, take.provider === 'manual' ? 'imported' : 'succeeded', take.model);
}

/** Bind an imported/downloaded MP4 (registered as a generated-video asset) to
 * its originating attempt, and move the scene into review. */
export function bindResultToTake(state: DirectorState, takeId: string, assetId: string, via: 'imported' | 'succeeded', model?: string | null): DirectorState {
  const take = state.takes.find((t) => t.id === takeId);
  if (!take) return state;
  const next: GenerationTake = { ...take, assetId, status: via, model: model ?? take.model };
  let s = replaceTake(state, next);
  const scene = s.scenes.find((sc) => sc.id === take.sceneId);
  if (scene && scene.status !== 'accepted') s = replaceScene(s, { ...scene, status: 'review' });
  return s;
}

/** Accept a take: it becomes the scene's accepted take; the scene is accepted;
 * the workprint recomputes staleness. Accepting a DIFFERENT take for a scene
 * that already had one only restales that scene's region on assembly. */
export function acceptTake(state: DirectorState, takeId: string): DirectorState {
  const take = state.takes.find((t) => t.id === takeId);
  if (!take || !take.assetId) return state; // cannot accept a take with no result
  const scene = state.scenes.find((s) => s.id === take.sceneId);
  if (!scene) return state;
  // exactly one accepted take per scene: clear acceptance on sibling takes
  const takes = state.takes.map((t) =>
    t.sceneId === take.sceneId ? { ...t, accepted: t.id === takeId } : t);
  const lipSync = take.lipSync === 'not-required' ? take.lipSync : (take.lipSync === 'passed' ? 'passed' : 'pending');
  const s1: DirectorState = { ...state, takes: takes.map((t) => (t.id === takeId ? { ...t, lipSync } : t)) };
  const s2 = replaceScene(s1, { ...scene, status: 'accepted', acceptedTakeId: takeId });
  return recomputeWorkprintStale(s2);
}

export function rejectTake(state: DirectorState, takeId: string): DirectorState {
  const take = state.takes.find((t) => t.id === takeId);
  if (!take) return state;
  const wasAccepted = take.accepted === true;
  const s1 = replaceTake(state, { ...take, accepted: false });
  const scene = s1.scenes.find((sc) => sc.id === take.sceneId);
  if (!scene) return recomputeWorkprintStale(s1);
  // if the rejected take was the accepted one, the scene loses its acceptance
  const nextScene = wasAccepted
    ? { ...scene, status: 'review' as const, acceptedTakeId: null }
    : scene;
  return recomputeWorkprintStale(replaceScene(s1, nextScene));
}

/** Add structured repair direction to a take and spawn a child attempt that
 * inherits the parent's compiled snapshot (regenerate ONLY this scene). */
export function addRepairAttempt(state: DirectorState, parentTakeId: string, repair: RepairDirection): { state: DirectorState; take: GenerationTake } {
  const parent = state.takes.find((t) => t.id === parentTakeId);
  const scene = parent ? state.scenes.find((s) => s.id === parent.sceneId) : undefined;
  if (!parent || !scene) return { state, take: parent as GenerationTake };
  const child = makeTake(scene, parent.requestSnapshot, parent.provider, parent.entityFingerprints, parentTakeId);
  child.repair = repair;
  child.notes = `Repair of take ${parentTakeId}`;
  const nextScene: ScenePlan = { ...scene, status: 'needs-repair' };
  return { state: replaceScene({ ...state, takes: [...state.takes, child] }, nextScene), take: child };
}

/** Mark a lip-sync outcome on a take. */
export function setLipSync(state: DirectorState, takeId: string, lipSync: GenerationTake['lipSync']): DirectorState {
  const take = state.takes.find((t) => t.id === takeId);
  if (!take) return state;
  return replaceTake(state, { ...take, lipSync });
}

/** Record that the workprint was built from the current accepted-take set. */
export function markWorkprintBuilt(state: DirectorState): DirectorState {
  const builtFromTakeIds = state.scenes
    .map((s) => s.acceptedTakeId)
    .filter((id): id is string => Boolean(id));
  return { ...state, workprint: { lastBuiltAt: new Date().toISOString(), builtFromTakeIds, builtSignature: assemblySignature(state), stale: false } };
}

export function takesForScene(state: DirectorState, sceneId: string): GenerationTake[] {
  return state.takes.filter((t) => t.sceneId === sceneId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

// ── §H1: identity apply transaction. The UI edits a draft; APPLY commits the
// canonical description/traits/reference-approvals and bumps version +
// fingerprint ONCE — not on every keystroke — so prior takes keep their
// fingerprint and provenance stays exact. ──────────────────────────────────
export function applyEntityIdentity(state: DirectorState, entityId: string, patch: Partial<Pick<DirectorEntity, 'name' | 'description' | 'lockedTraits' | 'variableTraits' | 'approved'>> & { references?: DirectorEntity['references'] }): DirectorState {
  const entity = state.entities.find((e) => e.id === entityId);
  if (!entity) return state;
  const merged: DirectorEntity = {
    ...entity,
    name: patch.name ?? entity.name,
    description: patch.description ?? entity.description,
    lockedTraits: patch.lockedTraits ?? entity.lockedTraits,
    variableTraits: patch.variableTraits ?? entity.variableTraits,
    approved: patch.approved ?? entity.approved,
    references: patch.references ?? entity.references,
  };
  // Only bump the identity version when the CANONICAL package actually changed.
  const before = computeIdentityFingerprint(entity);
  const after = computeIdentityFingerprint(merged);
  const next = before === after
    ? { ...merged, activeFingerprint: after }
    : refreshEntityIdentity(merged);
  return { ...state, entities: state.entities.map((e) => (e.id === entityId ? next : e)) };
}

// ── §H3: accepted scenes that overlap in song time are ambiguous to assemble.
// Block them until resolved (safer than hidden layering). ───────────────────
export function blockingOverlaps(state: DirectorState): Array<[string, string]> {
  const accepted = orderedScenes(state.scenes).filter((s) => s.acceptedTakeId);
  const out: Array<[string, string]> = [];
  for (let i = 0; i < accepted.length - 1; i++) {
    if (accepted[i + 1].startSec < accepted[i].endSec) out.push([accepted[i].id, accepted[i + 1].id]);
  }
  return out;
}

// ── §H4: removing a scene detaches its takes and lyric refs and restales the
// workprint — never leaves dangling takes, never deletes media files. ───────
export function removeScene(state: DirectorState, sceneId: string): DirectorState {
  const scenes = state.scenes.filter((s) => s.id !== sceneId);
  const takes = state.takes.filter((t) => t.sceneId !== sceneId); // detached takes dropped from state (their MP4 assets remain in the project)
  return recomputeWorkprintStale({ ...state, scenes, takes });
}

/** §H4: explicit re-time after an audio swap. 'clear' detaches all song-relative
 * direction (scenes+takes+lyrics) but keeps registered media; 'keep' asserts the
 * timings still hold. Either way songAudioPath is updated so the suspect gate
 * clears. Never silent. */
export function applyRetime(state: DirectorState, newAudioPath: string | null, mode: 'clear' | 'keep'): DirectorState {
  if (mode === 'keep') return recomputeWorkprintStale({ ...state, songAudioPath: newAudioPath });
  return {
    ...state, songAudioPath: newAudioPath,
    scenes: [], takes: [], lyrics: [],
    workprint: { lastBuiltAt: null, builtFromTakeIds: [], builtSignature: '', stale: false },
  };
}
