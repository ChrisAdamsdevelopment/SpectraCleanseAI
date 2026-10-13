// Pure Director state transitions (DEC-003 §10). UI components call these; they
// never touch IO. Every transition preserves the invariants: accepted scenes
// elsewhere are untouched, takes keep their compiled snapshots, and the
// workprint goes stale exactly when its included accepted-take set changes.

import {
  makeTake, makeScene, refreshEntityIdentity, assemblySignature, orderedScenes, computeIdentityFingerprint,
  type DirectorState, type DirectorEntity, type GenerationTake, type RepairDirection, type ScenePlan,
  type ContinuityRelationship,
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

/** §6: start the first executable lip-sync repair. Creates a child take whose
 * repair preserves everything outside the mouth and syncs the mouth to the
 * scene-local vocal over an optional interval. The parent take is preserved and
 * marked needs-repair (lip); the child carries lineage + lipSync 'pending'. */
export function addLipSyncRepair(state: DirectorState, parentTakeId: string, opts: { intervalSec?: { start: number; end: number } | null; performerEntityId?: string | null; note?: string }): { state: DirectorState; take: GenerationTake } {
  const parent = state.takes.find((t) => t.id === parentTakeId);
  const scene = parent ? state.scenes.find((s) => s.id === parent.sceneId) : undefined;
  if (!parent || !scene) return { state, take: parent as GenerationTake };
  const child = makeTake(scene, parent.requestSnapshot, parent.provider, parent.entityFingerprints, parentTakeId);
  child.repair = {
    kind: 'lip-sync',
    preserve: ['identity', 'wardrobe', 'camera', 'lighting', 'background', 'everything outside the mouth region'],
    change: ['mouth movement synchronized to the vocal'],
    intervalSec: opts.intervalSec ?? null,
    performerEntityId: opts.performerEntityId ?? null,
    note: opts.note ?? '',
  };
  child.lipSync = 'pending';
  child.notes = `Lip-sync repair of take ${parentTakeId}`;
  const takes = state.takes.map((t) => (t.id === parentTakeId ? { ...t, lipSync: 'needs-repair' as const } : t));
  const nextScene: ScenePlan = { ...scene, status: 'needs-repair' };
  return { state: replaceScene({ ...state, takes: [...takes, child] }, nextScene), take: child };
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

/** §H4 / §5: explicit re-time after an audio swap. Three canonical transitions,
 * all of which update songAudioPath so the suspect gate clears — never silent,
 * never leaving orphaned takes or pending provider jobs. The reusable visual
 * library (entities + references + tools + reference requests) is ALWAYS kept.
 *   - 'keep':   the timings still line up; keep everything as-is.
 *   - 'retime': keep the scenes & lyrics to re-time by hand, but detach all
 *               takes (and their pending jobs) + accepted links, and reset the
 *               workprint — nothing that was generated against the old song is
 *               silently reused.
 *   - 'clear':  remove all song-relative direction (scenes + lyrics + takes) and
 *               start the timeline over. */
// ── §7: scene splitting — two valid song-relative scenes at a boundary. ──────
// Direction is preserved on both halves; lyrics divide by song time (derived
// overlap + distributed explicit includes/excludes); accepted takes are NOT
// duplicated (the old scene's takes are dropped — a full-length clip is not a
// valid clip for either half); lineage is recorded in continuityNotes.
export function splitScene(state: DirectorState, sceneId: string, atSec: number): { state: DirectorState; parts: [ScenePlan, ScenePlan] | null } {
  const scene = state.scenes.find((s) => s.id === sceneId);
  if (!scene) return { state, parts: null };
  const at = Math.min(scene.endSec - 0.1, Math.max(scene.startSec + 0.1, atSec));
  const inA = (t: number) => t < at;
  const mk = (part: 1 | 2): ScenePlan => {
    const base = makeScene(`${scene.title} (${part})`, part === 1 ? scene.startSec : at, part === 1 ? at : scene.endSec);
    const belongs = (lid: string) => {
      const l = state.lyrics.find((x) => x.id === lid); if (!l) return false;
      const mid = (l.startSec + l.endSec) / 2; return part === 1 ? inA(mid) : !inA(mid);
    };
    return {
      ...scene, id: base.id, title: base.title,
      startSec: base.startSec, endSec: base.endSec,
      status: 'draft', acceptedTakeId: null,
      lyricEventIds: scene.lyricEventIds.filter(belongs),
      lyricExclude: scene.lyricExclude.filter(belongs),
      continuityNotes: `${scene.continuityNotes}${scene.continuityNotes ? ' · ' : ''}split of "${scene.title}" [part ${part} of 2]`,
      createdAt: base.createdAt,
    };
  };
  const a = mk(1); const b = mk(2);
  const scenes = state.scenes.flatMap((s) => (s.id === sceneId ? [a, b] : [s]));
  const takes = state.takes.filter((t) => t.sceneId !== sceneId); // no duplicated accepted takes
  return { state: recomputeWorkprintStale({ ...state, scenes, takes }), parts: [a, b] };
}

// ── §7: apply a preflight/readiness resolution that maps to a canonical change.
// UI-only resolutions (switch provider, export package, accept-knowingly) are
// handled by the workspace; this covers the ones that mutate director state.
export function applySceneResolution(state: DirectorState, sceneId: string, key: string): DirectorState {
  const scene = state.scenes.find((s) => s.id === sceneId);
  if (!scene) return state;
  const patch = (p: Partial<ScenePlan>): DirectorState => replaceScene(state, { ...scene, ...p });
  if (key.startsWith('relationship:')) {
    const [, entityId, rel] = key.split(':');
    return replaceScene(state, { ...scene, castings: scene.castings.map((c) => (c.entityId === entityId ? { ...c, relationship: rel as ContinuityRelationship } : c)) });
  }
  if (key.startsWith('camera-distance:')) return patch({ cameraDistance: key.split(':')[1] as ScenePlan['cameraDistance'] });
  if (key.startsWith('camera-motion:')) return patch({ cameraMotion: key.split(':')[1] as ScenePlan['cameraMotion'] });
  if (key.startsWith('lighting-style:')) return patch({ lightingStyle: key.split(':')[1] as ScenePlan['lightingStyle'] });
  if (key.startsWith('aspect:')) return patch({ generationPrefs: { ...scene.generationPrefs, aspect: key.split(':')[1] as '9:16' | '16:9' } });
  if (key.startsWith('policy:')) return patch({ shortClipPolicy: key.split(':')[1] as ScenePlan['shortClipPolicy'] });
  if (key.startsWith('shorten-scene:')) { const sec = Number(key.split(':')[1]); return Number.isFinite(sec) ? patch({ endSec: scene.startSec + sec }) : state; }
  if (key.startsWith('trim-refs:')) {
    const n = Number(key.split(':')[1]); if (!Number.isFinite(n)) return state;
    // Keep the first n references across castings in order, drop the rest.
    let remaining = n; const castings = scene.castings.map((c) => {
      const keep = c.referenceIds.slice(0, Math.max(0, remaining));
      remaining -= keep.length; return { ...c, referenceIds: keep };
    });
    return replaceScene(state, { ...scene, castings });
  }
  if (key === 'vocals-offcamera') {
    const lyrics = state.lyrics.map((l) => (l.startSec < scene.endSec && l.endSec > scene.startSec && l.mouthVisibility === 'required') ? { ...l, mouthVisibility: 'off-camera' as const } : l);
    return { ...state, lyrics };
  }
  if (key === 'split-scene') return splitScene(state, sceneId, (scene.startSec + scene.endSec) / 2).state;
  return state;
}

export function applyRetime(state: DirectorState, newAudioPath: string | null, mode: 'clear' | 'keep' | 'retime'): DirectorState {
  if (mode === 'keep') return recomputeWorkprintStale({ ...state, songAudioPath: newAudioPath });
  const freshWorkprint = { lastBuiltAt: null, builtFromTakeIds: [], builtSignature: '', stale: false };
  if (mode === 'retime') {
    const scenes = state.scenes.map((s) => ({ ...s, status: 'draft' as const, acceptedTakeId: null }));
    return { ...state, songAudioPath: newAudioPath, scenes, takes: [], workprint: freshWorkprint };
  }
  return { ...state, songAudioPath: newAudioPath, scenes: [], takes: [], lyrics: [], workprint: freshWorkprint };
}
