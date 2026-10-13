// Director Mode persistence normalization. Every persisted Director concept is
// re-validated on load: unknown enum values fall back safely, dangling ids are
// dropped, and a missing/absent director block normalizes to the empty state —
// so pre-Director projects open exactly as before. Mirrors the defensive style
// of project/storage.ts.

import {
  emptyDirectorState, computeIdentityFingerprint, ENTITY_TYPES, REFERENCE_KINDS,
  TOOL_FIELD_KINDS, CONDITIONING_RECIPES, POSE_JOINTS, CAMERA_MOVEMENTS,
  type DirectorState, type DirectorEntity, type ReferenceVariant, type ScenePlan,
  type GenerationTake, type LyricEvent, type DirectorTool, type ToolField,
  type SceneCasting, type ToolOutput, type EntityType, type ReferenceKind,
  type ConditioningRecipe, type PoseSequenceData, type PoseKey, type PoseJointId,
  type ReferenceRequest, type CameraPathData, type ImageBoardData, type ReferencePickData,
  type LyricBlocksData, type CameraMovementType, type MouthVisibility,
} from './model';
import { makeOutputId } from '../project/types';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
const str = (v: unknown, fb = ''): string => (typeof v === 'string' ? v : fb);
const num = (v: unknown, fb = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fb);
const bool = (v: unknown, fb = false): boolean => (typeof v === 'boolean' ? v : fb);
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const id = (v: unknown): string => (typeof v === 'string' && v ? v : makeOutputId());
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fb: T): T =>
  (allowed as readonly string[]).includes(v as string) ? (v as T) : fb;

function normalizeReference(v: unknown, entityId: string): ReferenceVariant | null {
  if (!isRecord(v) || typeof v.path !== 'string') return null;
  const prov = isRecord(v.provenance) ? v.provenance : {};
  return {
    id: id(v.id), entityId,
    kind: oneOf(v.kind, REFERENCE_KINDS, 'general' as ReferenceKind),
    path: v.path, label: str(v.label, 'reference'),
    origin: oneOf(v.origin, ['upload', 'ai-generated', 'imported-generation', 'approved-frame', 'derived'] as const, 'upload'),
    approved: bool(v.approved),
    contentDigest: typeof v.contentDigest === 'string' ? v.contentDigest : undefined,
    bodyLocation: typeof v.bodyLocation === 'string' ? v.bodyLocation : undefined,
    provenance: {
      generationAttemptId: typeof prov.generationAttemptId === 'string' ? prov.generationAttemptId : undefined,
      sourceTakeId: typeof prov.sourceTakeId === 'string' ? prov.sourceTakeId : undefined,
      note: typeof prov.note === 'string' ? prov.note : undefined,
    },
    createdAt: str(v.createdAt, new Date().toISOString()),
  };
}

function normalizeEntity(v: unknown): DirectorEntity | null {
  if (!isRecord(v) || typeof v.name !== 'string') return null;
  const eid = id(v.id);
  const references = Array.isArray(v.references)
    ? v.references.map((r) => normalizeReference(r, eid)).filter((r): r is ReferenceVariant => Boolean(r))
    : [];
  const entity: DirectorEntity = {
    id: eid, name: v.name,
    type: oneOf(v.type, ENTITY_TYPES, 'object' as EntityType),
    description: str(v.description),
    approved: bool(v.approved),
    version: Math.max(1, Math.floor(num(v.version, 1))),
    lockedTraits: strArr(v.lockedTraits), variableTraits: strArr(v.variableTraits),
    references, activeFingerprint: '', scope: 'project',
    history: Array.isArray(v.history)
      ? v.history.filter(isRecord).map((h) => ({ at: str(h.at), event: str(h.event) }))
      : [],
    createdAt: str(v.createdAt, new Date().toISOString()),
  };
  // Recompute rather than trust: the fingerprint is derived truth.
  entity.activeFingerprint = computeIdentityFingerprint(entity);
  return entity;
}

function normalizeCasting(v: unknown, entityIds: Set<string>): SceneCasting | null {
  if (!isRecord(v) || typeof v.entityId !== 'string' || !entityIds.has(v.entityId)) return null;
  return {
    entityId: v.entityId,
    relationship: oneOf(v.relationship, ['exact', 'consistent', 'related', 'invented'] as const, 'consistent'),
    mustRemain: strArr(v.mustRemain), mayVary: strArr(v.mayVary),
    referenceIds: strArr(v.referenceIds),
  };
}

function normalizePoseSequence(v: unknown): PoseSequenceData | null {
  if (!isRecord(v) || !Array.isArray(v.poses)) return null;
  const poses: PoseKey[] = [];
  for (const p of v.poses) {
    if (!isRecord(p) || !isRecord(p.joints)) continue;
    const joints = {} as Record<PoseJointId, { x: number; y: number }>;
    let ok = true;
    for (const j of POSE_JOINTS) {
      const jj = (p.joints as Record<string, unknown>)[j];
      if (!isRecord(jj) || typeof jj.x !== 'number' || typeof jj.y !== 'number') { ok = false; break; }
      joints[j] = { x: Math.min(1, Math.max(0, jj.x)), y: Math.min(1, Math.max(0, jj.y)) };
    }
    if (!ok) continue;
    poses.push({
      atBeat: num(p.atBeat), holdBeats: Math.max(0, num(p.holdBeats)),
      transition: oneOf(p.transition, ['smooth', 'snap', 'lock'] as const, 'smooth'),
      joints,
    });
  }
  return { poses };
}

function clamp01(n: unknown): number { return Math.min(1, Math.max(0, num(n, 0))); }

function normalizeCameraPath(v: unknown): CameraPathData | null {
  if (!isRecord(v) || !isRecord(v.start) || !isRecord(v.end)) return null;
  const pt = (p: unknown) => (isRecord(p) ? { x: clamp01(p.x), y: clamp01(p.y) } : { x: 0.5, y: 0.5 });
  return {
    start: pt(v.start), end: pt(v.end),
    control: Array.isArray(v.control) ? v.control.map(pt).slice(0, 4) : [],
    movement: oneOf(v.movement, CAMERA_MOVEMENTS, 'dolly' as CameraMovementType),
    orientation: str(v.orientation),
  };
}
function normalizeImageBoard(v: unknown): ImageBoardData | null {
  if (!isRecord(v) || !Array.isArray(v.items)) return null;
  const items = v.items.filter(isRecord).map((it) => ({
    id: id(it.id),
    referenceId: typeof it.referenceId === 'string' ? it.referenceId : undefined,
    assetId: typeof it.assetId === 'string' ? it.assetId : undefined,
    label: str(it.label),
  })).filter((it) => it.referenceId || it.assetId);
  return { items };
}
function normalizeReferencePick(v: unknown): ReferencePickData | null {
  if (!isRecord(v)) return null;
  return { referenceIds: strArr(v.referenceIds), assetIds: strArr(v.assetIds) };
}
function normalizeLyricBlocks(v: unknown): LyricBlocksData | null {
  if (!isRecord(v)) return null;
  const overrides: LyricBlocksData['overrides'] = {};
  if (isRecord(v.overrides)) {
    for (const [k, ov] of Object.entries(v.overrides)) {
      if (!isRecord(ov)) continue;
      overrides[k] = {
        mouthVisibility: ['required', 'preferred', 'off-camera', 'none'].includes(ov.mouthVisibility as string) ? ov.mouthVisibility as MouthVisibility : undefined,
        emphasis: typeof ov.emphasis === 'number' ? clamp01(ov.emphasis) : undefined,
      };
    }
  }
  return { selectedLyricIds: strArr(v.selectedLyricIds), overrides };
}

function normalizeToolOutput(v: unknown, tools: DirectorTool[]): ToolOutput | null {
  if (!isRecord(v) || typeof v.toolId !== 'string') return null;
  const tool = tools.find((t) => t.id === v.toolId);
  if (!tool) return null; // output without its tool is meaningless
  const rawValues = isRecord(v.values) ? v.values : {};
  const values: Record<string, unknown> = {};
  for (const field of tool.fields) {
    if (!(field.id in rawValues)) continue;
    const raw = rawValues[field.id];
    switch (field.kind) {
      case 'pose-sequence': { const ps = normalizePoseSequence(raw); if (ps) values[field.id] = ps; break; }
      case 'camera-path': { const cp = normalizeCameraPath(raw); if (cp) values[field.id] = cp; break; }
      case 'image-board': { const ib = normalizeImageBoard(raw); if (ib) values[field.id] = ib; break; }
      case 'reference-picker': { const rp = normalizeReferencePick(raw); if (rp) values[field.id] = rp; break; }
      case 'lyric-blocks': { const lb = normalizeLyricBlocks(raw); if (lb) values[field.id] = lb; break; }
      default: values[field.id] = raw;
    }
  }
  return { toolId: v.toolId, toolVersion: Math.max(1, Math.floor(num(v.toolVersion, 1))), values, updatedAt: str(v.updatedAt, new Date().toISOString()) };
}

function normalizeReferenceRequest(v: unknown, entityIds: Set<string>): ReferenceRequest | null {
  if (!isRecord(v) || typeof v.entityId !== 'string' || !entityIds.has(v.entityId)) return null;
  return {
    id: id(v.id), entityId: v.entityId,
    entityVersion: Math.max(1, Math.floor(num(v.entityVersion, 1))),
    kind: oneOf(v.kind, REFERENCE_KINDS, 'general' as ReferenceKind),
    direction: str(v.direction),
    conditioningReferenceIds: strArr(v.conditioningReferenceIds),
    traitsRemain: strArr(v.traitsRemain), traitsVary: strArr(v.traitsVary),
    outputCount: Math.max(1, Math.floor(num(v.outputCount, 1))),
    providerId: str(v.providerId, 'manual'),
    modelId: typeof v.modelId === 'string' ? v.modelId : null,
    readiness: oneOf(v.readiness, ['ready', 'warning', 'blocked'] as const, 'ready'),
    readinessNote: str(v.readinessNote),
    status: oneOf(v.status, ['draft', 'submitted', 'running', 'succeeded', 'failed', 'exported', 'imported'] as const, 'draft'),
    jobId: typeof v.jobId === 'string' ? v.jobId : null,
    error: typeof v.error === 'string' ? v.error : null,
    resultRefIds: strArr(v.resultRefIds),
    bodyLocation: typeof v.bodyLocation === 'string' ? v.bodyLocation : undefined,
    createdAt: str(v.createdAt, new Date().toISOString()),
  };
}

function normalizeScene(v: unknown, entityIds: Set<string>, tools: DirectorTool[]): ScenePlan | null {
  if (!isRecord(v)) return null;
  const startSec = num(v.startSec, NaN); const endSec = num(v.endSec, NaN);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || !(endSec > startSec)) return null;
  const prefs = isRecord(v.generationPrefs) ? v.generationPrefs : {};
  return {
    id: id(v.id), title: str(v.title, 'Scene'), startSec, endSec,
    purpose: str(v.purpose), description: str(v.description), action: str(v.action),
    movement: str(v.movement), environment: str(v.environment), camera: str(v.camera),
    cameraDistance: oneOf(v.cameraDistance, ['extreme-close', 'close', 'medium', 'wide', 'extreme-wide', 'unspecified'] as const, 'unspecified'),
    cameraMotion: oneOf(v.cameraMotion, ['locked', 'smooth', 'handheld', 'unstable', 'unspecified'] as const, 'unspecified'),
    lighting: str(v.lighting),
    lightingStyle: oneOf(v.lightingStyle, ['natural', 'stylized', 'silhouette', 'unspecified'] as const, 'unspecified'),
    styleGenre: str(v.styleGenre), emotion: str(v.emotion),
    continuityNotes: str(v.continuityNotes),
    castings: Array.isArray(v.castings) ? v.castings.map((c) => normalizeCasting(c, entityIds)).filter((c): c is SceneCasting => Boolean(c)) : [],
    invented: str(v.invented), howItBegins: str(v.howItBegins), howItEnds: str(v.howItEnds),
    lyricEventIds: strArr(v.lyricEventIds),
    lyricExclude: strArr(v.lyricExclude),
    shortClipPolicy: oneOf(v.shortClipPolicy, ['unset', 'hold-last', 'loop', 'shorten-scene', 'leave-gap'] as const, 'unset'),
    recipe: oneOf(v.recipe, CONDITIONING_RECIPES, 'separate-references' as ConditioningRecipe),
    generationPrefs: {
      aspect: oneOf(prefs.aspect, ['9:16', '16:9'] as const, '9:16'),
      resolution: oneOf(prefs.resolution, ['720p', '1080p'] as const, '720p'),
    },
    toolOutputs: Array.isArray(v.toolOutputs) ? v.toolOutputs.map((o) => normalizeToolOutput(o, tools)).filter((o): o is ToolOutput => Boolean(o)) : [],
    status: oneOf(v.status, ['draft', 'directed', 'awaiting-result', 'review', 'accepted', 'needs-repair'] as const, 'draft'),
    acceptedTakeId: typeof v.acceptedTakeId === 'string' ? v.acceptedTakeId : null,
    createdAt: str(v.createdAt, new Date().toISOString()),
  };
}

function normalizeTake(v: unknown, sceneIds: Set<string>): GenerationTake | null {
  if (!isRecord(v) || typeof v.sceneId !== 'string' || !sceneIds.has(v.sceneId)) return null;
  const snap = isRecord(v.requestSnapshot) ? v.requestSnapshot : {};
  const repair = isRecord(v.repair) ? v.repair : null;
  const interval = repair && isRecord(repair.intervalSec) ? repair.intervalSec : null;
  const pj = isRecord(v.providerJob) ? v.providerJob : {};
  const provider = str(v.provider, 'manual');
  const snapDuration = num(snap.durationSec, Math.max(0, num(snap.sceneEndSec) - num(snap.sceneStartSec)));
  return {
    id: id(v.id), sceneId: v.sceneId,
    requestSnapshot: {
      promptDigest: str(snap.promptDigest),
      recipe: oneOf(snap.recipe, CONDITIONING_RECIPES, 'separate-references' as ConditioningRecipe),
      referenceFiles: strArr(snap.referenceFiles),
      sceneStartSec: num(snap.sceneStartSec), sceneEndSec: num(snap.sceneEndSec),
      aspect: str(snap.aspect, '9:16'), resolution: str(snap.resolution, '720p'),
      durationSec: snapDuration,
    },
    provider, model: typeof v.model === 'string' ? v.model : null,
    submittedAt: typeof v.submittedAt === 'string' ? v.submittedAt : null,
    status: oneOf(v.status, ['packet-built', 'exported', 'submitted', 'polling', 'succeeded', 'failed', 'imported', 'cancelled'] as const, 'packet-built'),
    error: typeof v.error === 'string' ? v.error : null,
    assetId: typeof v.assetId === 'string' ? v.assetId : null,
    providerJob: {
      providerId: str(pj.providerId, provider),
      modelId: typeof pj.modelId === 'string' ? pj.modelId : null,
      jobId: typeof pj.jobId === 'string' ? pj.jobId : null,
      phase: oneOf(pj.phase, ['none', 'submitted', 'running', 'succeeded', 'failed', 'cancelled'] as const, 'none'),
      submittedAt: typeof pj.submittedAt === 'string' ? pj.submittedAt : null,
      lastPolledAt: typeof pj.lastPolledAt === 'string' ? pj.lastPolledAt : null,
      completedAt: typeof pj.completedAt === 'string' ? pj.completedAt : null,
      resultRef: typeof pj.resultRef === 'string' ? pj.resultRef : null,
      localResultPath: typeof pj.localResultPath === 'string' ? pj.localResultPath : null,
      error: typeof pj.error === 'string' ? pj.error : null,
      parentJobId: typeof pj.parentJobId === 'string' ? pj.parentJobId : null,
    },
    entityFingerprints: isRecord(v.entityFingerprints)
      ? Object.fromEntries(Object.entries(v.entityFingerprints).filter(([, fp]) => typeof fp === 'string')) as Record<string, string>
      : {},
    acceptedOverrides: strArr(v.acceptedOverrides),
    notes: str(v.notes),
    accepted: typeof v.accepted === 'boolean' ? v.accepted : null,
    lipSync: oneOf(v.lipSync, ['not-required', 'pending', 'passed', 'needs-repair'] as const, 'not-required'),
    repair: repair ? {
      kind: oneOf(repair.kind, ['general', 'lip-sync'] as const, 'general'),
      preserve: strArr(repair.preserve), change: strArr(repair.change),
      intervalSec: interval && typeof interval.start === 'number' && typeof interval.end === 'number'
        ? { start: interval.start, end: interval.end } : null,
      performerEntityId: typeof repair.performerEntityId === 'string' ? repair.performerEntityId : null,
      note: str(repair.note),
    } : null,
    parentTakeId: typeof v.parentTakeId === 'string' ? v.parentTakeId : null,
    createdAt: str(v.createdAt, new Date().toISOString()),
  };
}

function normalizeLyric(v: unknown): LyricEvent | null {
  if (!isRecord(v) || typeof v.word !== 'string') return null;
  const startSec = num(v.startSec, NaN); const endSec = num(v.endSec, NaN);
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || !(endSec > startSec)) return null;
  return {
    id: id(v.id),
    performerEntityId: typeof v.performerEntityId === 'string' ? v.performerEntityId : null,
    phrase: str(v.phrase, v.word), word: v.word, startSec, endSec,
    emphasis: Math.min(1, Math.max(0, num(v.emphasis, 0.5))),
    delivery: str(v.delivery), emotion: str(v.emotion),
    mouthVisibility: oneOf(v.mouthVisibility, ['required', 'preferred', 'off-camera', 'none'] as const, 'preferred'),
    role: oneOf(v.role, ['lead', 'background', 'adlib', 'narration', 'dialogue'] as const, 'lead'),
    breathAfter: bool(v.breathAfter),
    syllables: typeof v.syllables === 'number' ? v.syllables : undefined,
    phonemes: typeof v.phonemes === 'string' ? v.phonemes : undefined,
  };
}

function normalizeToolField(v: unknown): ToolField | null {
  if (!isRecord(v) || typeof v.id !== 'string' || typeof v.label !== 'string') return null;
  const kind = v.kind;
  if (!(TOOL_FIELD_KINDS as readonly string[]).includes(kind as string)) return null; // unknown primitive → dropped
  return {
    id: v.id, kind: kind as ToolField['kind'], label: v.label,
    help: typeof v.help === 'string' ? v.help : undefined,
    min: typeof v.min === 'number' ? v.min : undefined,
    max: typeof v.max === 'number' ? v.max : undefined,
    step: typeof v.step === 'number' ? v.step : undefined,
    labels: Array.isArray(v.labels) ? strArr(v.labels) : undefined,
    options: Array.isArray(v.options) ? strArr(v.options) : undefined,
    maxItems: typeof v.maxItems === 'number' ? v.maxItems : undefined,
    rows: Array.isArray(v.rows) ? strArr(v.rows) : undefined,
    columns: Array.isArray(v.columns) ? strArr(v.columns) : undefined,
    beats: typeof v.beats === 'number' ? v.beats : undefined,
    regions: Array.isArray(v.regions) ? strArr(v.regions) : undefined,
  };
}

function normalizeTool(v: unknown): DirectorTool | null {
  if (!isRecord(v) || typeof v.name !== 'string' || !Array.isArray(v.fields)) return null;
  const fields = v.fields.map(normalizeToolField).filter((f): f is ToolField => Boolean(f));
  if (fields.length === 0) return null;
  const outputSchema: Record<string, string> = {};
  if (isRecord(v.outputSchema)) {
    for (const [k, fv] of Object.entries(v.outputSchema)) {
      if (typeof fv === 'string' && fields.some((f) => f.id === fv)) outputSchema[k] = fv;
    }
  }
  return {
    id: id(v.id), name: v.name, description: str(v.description),
    version: Math.max(1, Math.floor(num(v.version, 1))),
    appliesTo: strArr(v.appliesTo) as DirectorTool['appliesTo'],
    fields, outputSchema,
    conflictRules: strArr(v.conflictRules), compileHints: str(v.compileHints),
    usageCount: Math.max(0, Math.floor(num(v.usageCount, 0))),
    importedFrom: typeof v.importedFrom === 'string' ? v.importedFrom : null,
    createdAt: str(v.createdAt, new Date().toISOString()),
  };
}

/** Normalize the persisted director block. Missing/invalid → empty state. */
export function normalizeDirectorState(value: unknown): DirectorState {
  const base = emptyDirectorState();
  if (!isRecord(value)) return base;

  const tools = Array.isArray(value.tools) ? value.tools.map(normalizeTool).filter((t): t is DirectorTool => Boolean(t)) : [];
  const entities = Array.isArray(value.entities) ? value.entities.map(normalizeEntity).filter((e): e is DirectorEntity => Boolean(e)) : [];
  const entityIds = new Set(entities.map((e) => e.id));
  const scenes = Array.isArray(value.scenes) ? value.scenes.map((s) => normalizeScene(s, entityIds, tools)).filter((s): s is ScenePlan => Boolean(s)) : [];
  const sceneIds = new Set(scenes.map((s) => s.id));
  const takes = Array.isArray(value.takes) ? value.takes.map((t) => normalizeTake(t, sceneIds)).filter((t): t is GenerationTake => Boolean(t)) : [];
  const takeIds = new Set(takes.map((t) => t.id));
  // acceptedTakeId must reference a real take; otherwise clear it.
  for (const s of scenes) if (s.acceptedTakeId && !takeIds.has(s.acceptedTakeId)) s.acceptedTakeId = null;
  const lyrics = Array.isArray(value.lyrics) ? value.lyrics.map(normalizeLyric).filter((l): l is LyricEvent => Boolean(l)) : [];
  const lyricIds = new Set(lyrics.map((l) => l.id));
  for (const s of scenes) s.lyricEventIds = s.lyricEventIds.filter((lid) => lyricIds.has(lid));
  const referenceRequests = Array.isArray(value.referenceRequests)
    ? value.referenceRequests.map((r) => normalizeReferenceRequest(r, entityIds)).filter((r): r is ReferenceRequest => Boolean(r))
    : [];

  const wp = isRecord(value.workprint) ? value.workprint : {};
  return {
    songAudioPath: typeof value.songAudioPath === 'string' ? value.songAudioPath : null,
    entities, scenes, takes, lyrics, tools, referenceRequests,
    workprint: {
      lastBuiltAt: typeof wp.lastBuiltAt === 'string' ? wp.lastBuiltAt : null,
      builtFromTakeIds: strArr(wp.builtFromTakeIds).filter((tid) => takeIds.has(tid)),
      builtSignature: str(wp.builtSignature),
      stale: bool(wp.stale),
    },
  };
}
