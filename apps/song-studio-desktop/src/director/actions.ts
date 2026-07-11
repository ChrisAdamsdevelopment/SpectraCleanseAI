// Pure Director state transitions (DEC-003 §10). UI components call these; they
// never touch IO. Every transition preserves the invariants: accepted scenes
// elsewhere are untouched, takes keep their compiled snapshots, and the
// workprint goes stale exactly when its included accepted-take set changes.

import { makeTake, type DirectorState, type GenerationTake, type RepairDirection, type ScenePlan } from './model';
import type { GenerationPacket } from './compile';

function replaceScene(state: DirectorState, scene: ScenePlan): DirectorState {
  return { ...state, scenes: state.scenes.map((s) => (s.id === scene.id ? scene : s)) };
}
function replaceTake(state: DirectorState, take: GenerationTake): DirectorState {
  return { ...state, takes: state.takes.map((t) => (t.id === take.id ? take : t)) };
}

/** The workprint is stale when the accepted-take set differs from the set it
 * was built from (or when it was never built while accepted takes exist). */
export function recomputeWorkprintStale(state: DirectorState): DirectorState {
  const accepted = state.scenes
    .map((s) => s.acceptedTakeId)
    .filter((id): id is string => Boolean(id))
    .sort();
  const built = [...state.workprint.builtFromTakeIds].sort();
  const same = accepted.length === built.length && accepted.every((id, i) => id === built[i]);
  const stale = state.workprint.lastBuiltAt === null ? accepted.length > 0 : !same;
  return { ...state, workprint: { ...state.workprint, stale } };
}

/** Create a take from a compiled packet (status packet-built). */
export function addTakeFromPacket(state: DirectorState, scene: ScenePlan, packet: GenerationPacket, provider: string, parentTakeId: string | null = null): { state: DirectorState; take: GenerationTake } {
  const take = makeTake(scene, {
    promptDigest: packet.promptDigest, recipe: packet.recipe,
    referenceFiles: packet.references.map((r) => r.fileName),
    sceneStartSec: packet.timing.sceneStartSec, sceneEndSec: packet.timing.sceneEndSec,
    aspect: packet.aspect, resolution: packet.resolution,
  }, provider, packet.entityFingerprints, parentTakeId);
  const nextScene: ScenePlan = { ...scene, status: 'awaiting-result' };
  return { state: replaceScene({ ...state, takes: [...state.takes, take] }, nextScene), take };
}

/** Mark a take's provider status (submitted/polling/failed/etc). */
export function setTakeStatus(state: DirectorState, takeId: string, status: GenerationTake['status'], patch: Partial<GenerationTake> = {}): DirectorState {
  const take = state.takes.find((t) => t.id === takeId);
  if (!take) return state;
  return replaceTake(state, { ...take, status, ...patch });
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
  return { ...state, workprint: { lastBuiltAt: new Date().toISOString(), builtFromTakeIds, stale: false } };
}

export function takesForScene(state: DirectorState, sceneId: string): GenerationTake[] {
  return state.takes.filter((t) => t.sceneId === sceneId).sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}
