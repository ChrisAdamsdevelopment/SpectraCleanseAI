import { useMemo, useRef, useState } from 'react';
import type { DirectorCtx } from './context';
import {
  makeScene, orderedScenes, sceneOverlaps, RELATIONSHIP_MEANING, CONDITIONING_RECIPES,
  type ScenePlan, type SceneCasting, type ContinuityRelationship, type GenerationTake,
} from '../director/model';
import { preflightScene } from '../director/preflight';
import { compileScenePacket, buildRepairPrompt, compileRepairPacket, compileLipSyncRepairPacket, type GenerationPacket } from '../director/compile';
import { assessProviderReadiness, unresolvedOverrideKeys, type ReadinessResult } from '../director/providerReadiness';
import { ToolFieldRenderer, type ToolFieldEnv } from './ToolFieldRenderer';
import {
  addTakeFromPacket, acceptTake, rejectTake, addRepairAttempt, addLipSyncRepair, resumableTakes,
  takesForScene, setTakeStatus, applyProviderSubmit, applyProviderPoll, applyProviderResult, applySceneResolution,
} from '../director/actions';
import { useAutoPoll } from './useAutoPoll';
import { formatTime } from '../lib/time';
import { makeOutputId } from '../project/types';

function fmt(t: number) { return formatTime(Math.max(0, t)); }

export function SceneBoard({ ctx }: { ctx: DirectorCtx }) {
  const { state, update, host } = ctx;
  const [selId, setSelId] = useState<string | null>(state.scenes[0]?.id ?? null);
  const scenes = useMemo(() => orderedScenes(state.scenes), [state.scenes]);
  const overlaps = useMemo(() => sceneOverlaps(state.scenes), [state.scenes]);
  const scene = state.scenes.find((s) => s.id === selId) ?? null;
  const dur = ctx.songDurationSec ?? 0;

  // AUTOMATIC bounded polling (§4). Any pending provider job — including ones
  // resumed after reopening the project — is polled to completion with backoff,
  // materialized, and bound. The explicit "Check status" control still works.
  const stateRef = useRef(state); stateRef.current = state;
  const pendingKeys = useMemo(() => resumableTakes(state).map((t) => t.id), [state.takes]);
  const pollOnce = async (takeId: string): Promise<string> => {
    const cur = stateRef.current;
    const take = cur.takes.find((t) => t.id === takeId);
    if (!take?.providerJob.jobId || take.assetId) return 'succeeded';
    const res = await host.pollGeneration(take.providerJob.jobId);
    if (res.phase === 'succeeded' && res.resultPath) {
      const sc = cur.scenes.find((s) => s.id === take.sceneId);
      const assetId = ctx.addAsset('generated-video', res.resultPath, `${sc?.title ?? 'scene'} take`);
      update(applyProviderResult(cur, takeId, assetId, res.resultPath));
      return 'succeeded';
    }
    if (res.phase === 'failed') { update(applyProviderPoll(cur, takeId, { phase: 'failed', error: res.error })); return 'failed'; }
    update(applyProviderPoll(cur, takeId, { phase: 'running' }));
    return 'running';
  };
  useAutoPoll({ pendingKeys, pollOnce, projectToken: ctx.audioPath ?? '', enabled: host.providerConfigured() });

  const addScene = () => {
    const last = orderedScenes(state.scenes)[state.scenes.length - 1];
    const start = last ? Math.min(dur - 4, last.endSec) : 0;
    const s = makeScene(`Scene ${state.scenes.length + 1}`, Math.max(0, start), Math.max(4, Math.min(dur || start + 8, start + 8)));
    update({ ...state, scenes: [...state.scenes, s] });
    setSelId(s.id);
  };
  const patch = (p: Partial<ScenePlan>) => scene && update({ ...state, scenes: state.scenes.map((s) => (s.id === scene.id ? { ...s, ...p } : s)) });
  const removeScene = () => scene && update({ ...state, scenes: state.scenes.filter((s) => s.id !== scene.id), takes: state.takes.filter((t) => t.sceneId !== scene.id) });

  return (
    <div className="dir-scenes">
      <div className="dir-scene-strip">
        <div className="dir-scene-strip-head"><h4>Scenes across the song</h4><button className="ghost small" onClick={addScene} disabled={!dur}>+ scene</button></div>
        {!dur && <div className="muted small">Add a song to the project to plan scenes across song time.</div>}
        <div className="dir-scene-cards">
          {scenes.map((s) => (
            <button key={s.id} className={`dir-scene-card${s.id === selId ? ' on' : ''} status-${s.status}`} onClick={() => setSelId(s.id)}>
              <b>{s.title}</b>
              <span className="muted small">{fmt(s.startSec)}–{fmt(s.endSec)}</span>
              <span className={`dir-scene-status ${s.status}`}>{s.status.replace('-', ' ')}</span>
            </button>
          ))}
        </div>
        {overlaps.length > 0 && <div className="dir-warn small">Some scenes overlap in song time — that is allowed while planning, but assembly plays the earlier scene first.</div>}
      </div>
      {scene ? <SceneEditor ctx={ctx} scene={scene} patch={patch} remove={removeScene} /> : <div className="dir-scene-editor muted">Select or add a scene to direct it.</div>}
    </div>
  );
}

function SceneEditor({ ctx, scene, patch, remove }: { ctx: DirectorCtx; scene: ScenePlan; patch: (p: Partial<ScenePlan>) => void; remove: () => void }) {
  const { state, update, host } = ctx;
  const [packet, setPacket] = useState<GenerationPacket | null>(null);
  const [busy, setBusy] = useState('');
  const [overrides, setOverrides] = useState<string[]>([]);
  const toggleOverride = (key: string) => setOverrides((o) => (o.includes(key) ? o.filter((k) => k !== key) : [...o, key]));
  const conflicts = useMemo(() => preflightScene(scene, state), [scene, state]);
  const takes = takesForScene(state, scene.id);
  const dur = ctx.songDurationSec ?? 0;

  // Project env for the rich directing primitives (reference-picker / image-board
  // / lyric-blocks) — approved references, project assets, and the lyrics that
  // overlap this scene in song time.
  const toolEnv: ToolFieldEnv = useMemo(() => ({
    references: state.entities.flatMap((e) => e.references.filter((r) => r.approved).map((r) => ({ id: r.id, label: r.label, kind: r.kind, path: r.path, entityName: e.name }))),
    assets: ctx.assets.map((a) => ({ id: a.id, label: a.label, path: a.path })),
    lyrics: state.lyrics.filter((l) => l.startSec < scene.endSec && l.endSec > scene.startSec).sort((a, b) => a.startSec - b.startSec),
    toSrc: (p) => ctx.host.toSrc(p),
  }), [state.entities, state.lyrics, ctx, scene.startSec, scene.endSec]);

  const setCasting = (entityId: string, up: Partial<SceneCasting> | null) => {
    const exists = scene.castings.find((c) => c.entityId === entityId);
    let castings: SceneCasting[];
    if (up === null) castings = scene.castings.filter((c) => c.entityId !== entityId);
    else if (exists) castings = scene.castings.map((c) => (c.entityId === entityId ? { ...c, ...up } : c));
    else castings = [...scene.castings, { entityId, relationship: 'consistent', mustRemain: [], mayVary: [], referenceIds: [], ...up }];
    patch({ castings });
  };

  const compile = () => {
    const attemptId = 'preview-' + scene.id;
    setPacket(compileScenePacket(state, scene, { attemptId, recipe: scene.recipe, audioPath: ctx.audioPath }));
  };
  const providerId = host.selectedProviderId();
  const caps = host.providerCapabilities();
  const readiness = packet ? assessProviderReadiness(packet, caps, host.providers().find((p) => p.id === providerId)?.label ?? providerId) : null;
  const previewPacket = useMemo(() => compileScenePacket(state, scene, { attemptId: 'chk', recipe: scene.recipe, audioPath: ctx.audioPath }), [state, scene, ctx.audioPath]);
  const previewReadiness = assessProviderReadiness(previewPacket, caps, providerId);
  const previewUnresolved = unresolvedOverrideKeys(previewReadiness, overrides);
  const canGenerate = !conflicts.some((c) => c.severity === 'blocking') && previewUnresolved.length === 0;

  const exportPacket = async () => {
    if (!host.canExportPackets) { setBusy('File export needs the desktop app (npm run tauri dev).'); return; }
    const dir = await host.pickPacketDir(); if (!dir) return;
    setBusy('Exporting package…');
    try {
      // One compile: the take id IS the packet attemptId, so the persisted take
      // and the package's return contract share a single identity.
      const takeId = makeOutputId();
      const pk = compileScenePacket(state, scene, { attemptId: takeId, recipe: scene.recipe, audioPath: ctx.audioPath });
      const { state: s2, take } = addTakeFromPacket(state, scene, pk, 'manual', null, takeId);
      const dest = `${dir}/scene-${scene.title.replace(/[^a-z0-9]+/gi, '_')}-${take.id}`;
      await host.writePacket(pk, dest);
      update(setTakeStatus(s2, take.id, 'exported'));
      setBusy(`Package written to ${dest}. Generate an MP4 externally, then Import result.`);
    } catch (e) { setBusy(`Export failed: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const submitLive = async () => {
    if (previewUnresolved.length > 0) { setBusy('Resolve the highlighted provider conflicts before generating.'); return; }
    setBusy(`Submitting to ${host.providers().find((p) => p.id === providerId)?.label ?? providerId}…`);
    const takeId = makeOutputId();
    const pk = compileScenePacket(state, scene, { attemptId: takeId, recipe: scene.recipe, audioPath: ctx.audioPath });
    let s2 = addTakeFromPacket(state, scene, pk, providerId, null, takeId).state;
    // record the creator's accepted overrides on the attempt (audit of what was
    // knowingly relaxed) and submit.
    s2 = { ...s2, takes: s2.takes.map((t) => (t.id === takeId ? { ...t, acceptedOverrides: overrides } : t)) };
    update(s2);
    const outcome = await host.submitGeneration(pk);
    if (!outcome.ok) {
      update(applyProviderSubmit(s2, takeId, { providerId, modelId: caps.notes ? providerId : null, jobId: null, phase: 'failed', error: outcome.blockedReason || outcome.error || 'submit failed' }));
      setBusy(outcome.blockedReason ? `Live generation blocked: ${outcome.blockedReason} (use Export package instead)` : `Submit failed: ${outcome.error}`);
      return;
    }
    const s3 = applyProviderSubmit(s2, takeId, { providerId, modelId: providerId, jobId: outcome.jobId ?? null, phase: 'submitted' });
    update(s3);
    setBusy(`Submitted (job ${outcome.jobId}). Checking status…`);
    await pollTake(takeId, s3);
  };

  // Poll a submitted take to completion (bounded), materialize the MP4, register
  // it as a generated-video asset, and bind it to the exact take. Also used by
  // the explicit "Check status" control and to resume after reopen.
  const pollTake = async (takeId: string, from = state) => {
    const take = from.takes.find((t) => t.id === takeId);
    if (!take?.providerJob.jobId) { setBusy('No provider job to check for this take.'); return; }
    setBusy('Checking generation status…');
    const res = await host.pollGeneration(take.providerJob.jobId);
    if (res.phase === 'succeeded' && res.resultPath) {
      const assetId = ctx.addAsset('generated-video', res.resultPath, `${scene.title} take`);
      update(applyProviderResult(from, takeId, assetId, res.resultPath));
      setBusy('Generated video received — review it below.');
    } else if (res.phase === 'failed') {
      update(applyProviderPoll(from, takeId, { phase: 'failed', error: res.error }));
      setBusy(`Generation failed: ${res.error ?? 'unknown error'}`);
    } else {
      update(applyProviderPoll(from, takeId, { phase: 'running' }));
      setBusy('Still generating — check again in a moment.');
    }
  };

  const importResult = async (takeId: string) => {
    const path = await host.pickGeneratedVideo(); if (!path) return;
    const bind = await host.resolveReturnAttempt(path, takeId);
    const boundTake = bind.attemptId && bind.attemptId !== takeId
      ? state.takes.find((t) => t.id === bind.attemptId)?.id ?? takeId
      : takeId;
    const assetId = ctx.addAsset('generated-video', path, `${scene.title} take`);
    update(applyProviderResult(state, boundTake, assetId, path));
    setBusy(bind.via === 'manifest' ? 'Imported and bound via the package return-manifest.' : 'Imported and bound to this attempt.');
  };

  // Resolve the source MP4 for a repair/lip-sync child (its parent's clip).
  const sourceVideoFor = (child: GenerationTake): string | null => {
    const parent = state.takes.find((t) => t.id === child.parentTakeId);
    return parent?.assetId ? ctx.assetPath(parent.assetId) : null;
  };

  // Generate a repair/lip-sync child take LIVE: the source video + the repair
  // prompt (mouth-sync for lip-sync) go to the provider's source-video edit path;
  // the parent interaction id carries conversational lineage when supported.
  const generateChildLive = async (child: GenerationTake) => {
    const src = sourceVideoFor(child);
    if (!src) { setBusy('The parent take has no accepted clip to repair from.'); return; }
    if (!child.repair) { setBusy('This take has no repair direction.'); return; }
    const parent = state.takes.find((t) => t.id === child.parentTakeId);
    const base = compileScenePacket(state, scene, { attemptId: child.id, recipe: scene.recipe, audioPath: ctx.audioPath });
    const pk: GenerationPacket = { ...base, prompt: buildRepairPrompt(scene, state, child.repair) };
    update(applyProviderSubmit(state, child.id, { providerId, modelId: providerId, jobId: null, phase: 'submitted' }));
    setBusy(`Submitting ${child.repair.kind === 'lip-sync' ? 'lip-sync' : 'repair'} edit…`);
    const outcome = await host.submitGeneration(pk, { sourceVideoPath: src, parentInteractionId: parent?.providerJob.jobId ?? undefined });
    if (!outcome.ok) {
      update(applyProviderSubmit(state, child.id, { providerId, modelId: null, jobId: null, phase: 'failed', error: outcome.blockedReason || outcome.error || 'submit failed' }));
      setBusy(outcome.blockedReason ? `Blocked: ${outcome.blockedReason} (use Export package)` : `Submit failed: ${outcome.error}`);
      return;
    }
    const s3 = applyProviderSubmit(state, child.id, { providerId, modelId: providerId, jobId: outcome.jobId ?? null, phase: 'submitted', parentJobId: parent?.providerJob.jobId ?? null });
    update(s3);
    setBusy(`Submitted (job ${outcome.jobId}). Auto-polling…`);
    await pollTake(child.id, s3);
  };

  // Export the manual repair / lip-sync package for a child take.
  const exportChildPackage = async (child: GenerationTake) => {
    if (!host.canExportPackets) { setBusy('File export needs the desktop app.'); return; }
    const src = sourceVideoFor(child);
    if (!src) { setBusy('The parent take has no accepted clip to repair from.'); return; }
    const parent = state.takes.find((t) => t.id === child.parentTakeId);
    const dir = await host.pickPacketDir(); if (!dir) return;
    const isLip = child.repair?.kind === 'lip-sync';
    const files = isLip
      ? compileLipSyncRepairPacket(state, scene, parent ?? child, { sourceVideoPath: src, audioPath: ctx.audioPath, intervalSec: child.repair?.intervalSec ?? null })
      : compileRepairPacket(state, scene, { ...(parent ?? child), repair: child.repair }, { attemptId: child.id, sourceVideoPath: src, audioPath: ctx.audioPath }).files;
    // Include a return-manifest so the imported MP4 binds to THIS child take.
    files.push({ kind: 'text', relPath: 'return-manifest.json', content: JSON.stringify({ attemptId: child.id }, null, 2) });
    const dest = `${dir}/${isLip ? 'lipsync' : 'repair'}-${scene.title.replace(/[^a-z0-9]+/gi, '_')}-${child.id}`;
    setBusy('Exporting package…');
    try {
      await host.writeFiles(files, dest);
      update(setTakeStatus(state, child.id, 'exported'));
      setBusy(`${isLip ? 'Lip-sync' : 'Repair'} package written to ${dest}. Generate externally, then Import result.`);
    } catch (e) { setBusy(`Export failed: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const startLipSync = (parentTakeId: string, intervalSec: { start: number; end: number } | null, performerEntityId: string | null) => {
    const { state: s2 } = addLipSyncRepair(state, parentTakeId, { intervalSec, performerEntityId });
    update(s2);
    setBusy('Lip-sync repair attempt created — generate it live or export the package below.');
  };

  // §7: execute a preflight/readiness resolution. Canonical state changes go
  // through applySceneResolution; provider switches and package export are UI
  // side effects. Overrides stay available only for genuine warnings.
  const dispatchResolution = (key: string) => {
    if (key === 'export-package') { exportPacket(); return; }
    if (key.startsWith('provider:')) { host.setProvider(key.split(':')[1]); update({ ...state }); return; }
    update(applySceneResolution(state, scene.id, key));
  };

  const entitiesById = Object.fromEntries(state.entities.map((e) => [e.id, e]));

  return (
    <div className="dir-scene-editor">
      <div className="dir-scene-editor-head">
        <input className="dir-scene-title" value={scene.title} onChange={(e) => patch({ title: e.target.value })} />
        <div className="dir-scene-times">
          <label>Start <input type="number" min={0} max={dur} step={0.5} value={scene.startSec} onChange={(e) => patch({ startSec: Number(e.target.value) })} /></label>
          <label>End <input type="number" min={0} max={dur} step={0.5} value={scene.endSec} onChange={(e) => patch({ endSec: Number(e.target.value) })} /></label>
          <button className="ghost small" onClick={remove}>Delete scene</button>
        </div>
      </div>

      <div className="dir-grid2">
        <label className="dir-field"><span>What happens?</span><textarea rows={2} value={scene.action} onChange={(e) => patch({ action: e.target.value })} /></label>
        <label className="dir-field"><span>How does it move?</span><textarea rows={2} value={scene.movement} onChange={(e) => patch({ movement: e.target.value })} /></label>
        <label className="dir-field"><span>Where does it happen?</span><textarea rows={2} value={scene.environment} onChange={(e) => patch({ environment: e.target.value })} /></label>
        <label className="dir-field"><span>How should it feel?</span><input value={scene.emotion} onChange={(e) => patch({ emotion: e.target.value })} /></label>
        <label className="dir-field"><span>Where is the camera / how does it move?</span><input value={scene.camera} onChange={(e) => patch({ camera: e.target.value })} /></label>
        <div className="dir-field-row">
          <label className="dir-field"><span>Distance</span>
            <select value={scene.cameraDistance} onChange={(e) => patch({ cameraDistance: e.target.value as ScenePlan['cameraDistance'] })}>
              {['extreme-close', 'close', 'medium', 'wide', 'extreme-wide', 'unspecified'].map((v) => <option key={v} value={v}>{v.replace('-', ' ')}</option>)}
            </select>
          </label>
          <label className="dir-field"><span>Camera motion</span>
            <select value={scene.cameraMotion} onChange={(e) => patch({ cameraMotion: e.target.value as ScenePlan['cameraMotion'] })}>
              {['locked', 'smooth', 'handheld', 'unstable', 'unspecified'].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </div>
        <label className="dir-field"><span>Lighting</span><input value={scene.lighting} onChange={(e) => patch({ lighting: e.target.value })} /></label>
        <label className="dir-field"><span>Lighting style</span>
          <select value={scene.lightingStyle} onChange={(e) => patch({ lightingStyle: e.target.value as ScenePlan['lightingStyle'] })}>
            {['natural', 'stylized', 'silhouette', 'unspecified'].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </label>
        <label className="dir-field"><span>Style / genre</span><input value={scene.styleGenre} onChange={(e) => patch({ styleGenre: e.target.value })} /></label>
        <label className="dir-field"><span>How should it begin?</span><input value={scene.howItBegins} onChange={(e) => patch({ howItBegins: e.target.value })} /></label>
        <label className="dir-field"><span>How should it end?</span><input value={scene.howItEnds} onChange={(e) => patch({ howItEnds: e.target.value })} /></label>
        <label className="dir-field"><span>What should the AI invent?</span><textarea rows={2} value={scene.invented} onChange={(e) => patch({ invented: e.target.value })} /></label>
      </div>

      {/* Casting: who/what is here + continuity relationship + references */}
      <h4>Who or what is here?</h4>
      <div className="dir-cast">
        {state.entities.map((e) => {
          const c = scene.castings.find((x) => x.entityId === e.id);
          return (
            <div key={e.id} className={`dir-cast-row${c ? ' on' : ''}`}>
              <label className="dir-cast-name"><input type="checkbox" checked={Boolean(c)} onChange={(ev) => setCasting(e.id, ev.target.checked ? {} : null)} /> <b>{e.name}</b> <span className="muted small">{e.type}</span></label>
              {c && (
                <div className="dir-cast-detail">
                  <select value={c.relationship} onChange={(ev) => setCasting(e.id, { relationship: ev.target.value as ContinuityRelationship })} title={RELATIONSHIP_MEANING[c.relationship]}>
                    {(['exact', 'consistent', 'related', 'invented'] as const).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <span className="muted small dir-rel-meaning">{RELATIONSHIP_MEANING[c.relationship]}</span>
                  <div className="dir-cast-refs">
                    {e.references.filter((r) => r.approved).map((r) => (
                      <label key={r.id} className={`chip small${c.referenceIds.includes(r.id) ? ' ok' : ''}`}>
                        <input type="checkbox" checked={c.referenceIds.includes(r.id)} onChange={(ev) => setCasting(e.id, { referenceIds: ev.target.checked ? [...c.referenceIds, r.id] : c.referenceIds.filter((x) => x !== r.id) })} /> {r.kind}
                      </label>
                    ))}
                    {e.references.filter((r) => r.approved).length === 0 && <span className="muted small">no approved references yet</span>}
                  </div>
                  <input className="dir-cast-mr" placeholder="must remain (comma-sep)" defaultValue={c.mustRemain.join(', ')} onBlur={(ev) => setCasting(e.id, { mustRemain: ev.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
                  <input className="dir-cast-mr" placeholder="may vary (comma-sep)" defaultValue={c.mayVary.join(', ')} onBlur={(ev) => setCasting(e.id, { mayVary: ev.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
                </div>
              )}
            </div>
          );
        })}
        {state.entities.length === 0 && <div className="muted small">Create entities in the Visual Library first, then cast them here.</div>}
      </div>

      {/* Installed directing tools applicable to scenes */}
      {state.tools.filter((t) => t.appliesTo.includes('scene')).length > 0 && (
        <details className="dir-tools-in-scene">
          <summary>Directing tools</summary>
          {state.tools.filter((t) => t.appliesTo.includes('scene')).map((tool) => {
            const out = scene.toolOutputs.find((o) => o.toolId === tool.id);
            const setVal = (fieldId: string, v: unknown) => {
              const values = { ...(out?.values ?? {}), [fieldId]: v };
              const toolOutputs = out
                ? scene.toolOutputs.map((o) => (o.toolId === tool.id ? { ...o, values, updatedAt: new Date().toISOString() } : o))
                : [...scene.toolOutputs, { toolId: tool.id, toolVersion: tool.version, values, updatedAt: new Date().toISOString() }];
              patch({ toolOutputs });
            };
            return (
              <div key={tool.id} className="dir-tool-instance">
                <b>{tool.name}</b>
                {tool.fields.map((f) => (
                  <div key={f.id} className="dir-tool-field"><span className="muted small">{f.label}</span>
                    <ToolFieldRenderer field={f} value={out?.values[f.id]} onChange={(v) => setVal(f.id, v)} env={toolEnv} />
                  </div>
                ))}
              </div>
            );
          })}
        </details>
      )}

      {/* Conflict preflight — director language, real choices */}
      {conflicts.length > 0 && (
        <div className="dir-preflight">
          <h4>Before you generate — {conflicts.length} thing{conflicts.length > 1 ? 's' : ''} to resolve</h4>
          {conflicts.map((c) => (
            <div key={c.id} className={`dir-conflict ${c.severity}`}>
              <b>{c.title}</b><p>{c.explanation}</p>
              <div className="dir-conflict-choices">
                {(c.actions ?? []).map((a) => <button key={a.key} className="chip small action" onClick={() => dispatchResolution(a.key)}>{a.label}</button>)}
                {c.choices.filter((ch) => !(c.actions ?? []).length || ch === 'Continue knowingly').map((ch) => <span key={ch} className="chip small">{ch}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Provider + generate + export */}
      <div className="dir-generate-bar">
        <label className="dir-provider-select">Provider
          <select value={providerId} onChange={(e) => { host.setProvider(e.target.value); update({ ...state }); }}>
            {host.providers().map((p) => <option key={p.id} value={p.id}>{p.label}{p.role === 'default' ? ' (default)' : ''}</option>)}
          </select>
        </label>
        <label className="dir-provider-select">Conditioning
          <select value={scene.recipe} onChange={(e) => patch({ recipe: e.target.value as ScenePlan['recipe'] })} title="How this scene's identity/motion is packaged for the generator">
            {CONDITIONING_RECIPES.map((r) => <option key={r} value={r}>{r.replace(/-/g, ' ')}</option>)}
          </select>
        </label>
        <button className="ghost small" onClick={compile}>Inspect compiled packet</button>
        <button className="ghost small" onClick={exportPacket} disabled={!host.canExportPackets} title={host.canExportPackets ? 'Write a complete manual generation package to a folder' : 'File export needs the desktop app (npm run tauri dev)'}>Export generation package</button>
        <button className="primary small" onClick={submitLive} disabled={!canGenerate} title={canGenerate ? '' : 'Resolve conflicts first'}>
          {ctx.host.providerConfigured() ? `Generate with ${host.providers().find((p) => p.id === providerId)?.label ?? providerId}` : 'Generate (needs API key)'}
        </button>
      </div>
      {/* Provider readiness — blocks are actionable, never silently dropped (§C) */}
      {previewReadiness.items.length > 0 && (
        <div className="dir-readiness">
          {previewReadiness.items.map((it) => (
            <div key={it.id} className={`dir-conflict ${it.severity}`}>
              <b>{it.message}</b>
              <div className="dir-conflict-choices">
                {(it.actions ?? []).map((a) => <button key={a.key} className="chip small action" onClick={() => dispatchResolution(a.key)}>{a.label}</button>)}
                {(it.actions ?? []).length === 0 && it.resolutions.map((r) => <span key={r} className="chip small">{r}</span>)}
                {it.overrideKey && it.severity === 'blocking' && (
                  <button className={`chip small ${overrides.includes(it.overrideKey) ? 'on' : ''}`} onClick={() => toggleOverride(it.overrideKey!)}>
                    {overrides.includes(it.overrideKey) ? '✓ Accepted knowingly' : 'Accept & continue knowingly'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {busy && <div className="dir-busy small">{busy}</div>}

      {packet && <PacketInspector packet={packet} readiness={readiness} onClose={() => setPacket(null)} host={host} />}

      {/* Takes */}
      <h4>Takes for this scene</h4>
      <div className="dir-takes">
        {takes.length === 0 && <div className="muted small">No takes yet. Export a package or generate to create the first attempt.</div>}
        {takes.map((t) => (
          <TakeRow key={t.id} ctx={ctx} scene={scene} take={t} onImport={() => importResult(t.id)}
            onCheckStatus={t.providerJob.jobId && !t.assetId ? () => pollTake(t.id) : undefined}
            onAccept={() => update(acceptTake(state, t.id))}
            onReject={() => update(rejectTake(state, t.id))}
            onLipSync={(v) => update(setTakeStatus(state, t.id, t.status, { lipSync: v }))}
            onRepair={(preserve, change, note) => { const { state: s2 } = addRepairAttempt(state, t.id, { kind: 'general', preserve, change, intervalSec: null, note }); update(s2); }}
            onStartLipSync={(interval, performerId) => startLipSync(t.id, interval, performerId)}
            onGenerateChild={() => generateChildLive(t)}
            onExportChild={() => exportChildPackage(t)}
            performers={state.entities.filter((e) => e.type === 'person' || e.type === 'character').map((e) => ({ id: e.id, name: e.name }))}
            entityName={(id) => entitiesById[id]?.name ?? id} />
        ))}
      </div>
    </div>
  );
}

function TakeRow({ ctx, scene, take, onImport, onCheckStatus, onAccept, onReject, onLipSync, onRepair, onStartLipSync, onGenerateChild, onExportChild, performers }: {
  ctx: DirectorCtx; scene: ScenePlan; take: GenerationTake;
  onImport: () => void; onCheckStatus?: () => void; onAccept: () => void; onReject: () => void;
  onLipSync: (v: GenerationTake['lipSync']) => void;
  onRepair: (preserve: string[], change: string[], note: string) => void;
  onStartLipSync: (interval: { start: number; end: number } | null, performerId: string | null) => void;
  onGenerateChild: () => void; onExportChild: () => void;
  performers: Array<{ id: string; name: string }>; entityName: (id: string) => string;
}) {
  const [repairing, setRepairing] = useState(false);
  const [preserve, setPreserve] = useState(''); const [change, setChange] = useState(''); const [note, setNote] = useState('');
  const [lipping, setLipping] = useState(false);
  const [lipStart, setLipStart] = useState(scene.startSec); const [lipEnd, setLipEnd] = useState(scene.endSec);
  const [lipPerformer, setLipPerformer] = useState(performers[0]?.id ?? '');
  const src = take.assetId ? ctx.host.toSrc(ctx.assetPath(take.assetId) ?? '') : null;
  const isChild = Boolean(take.parentTakeId && take.repair);
  const isLipChild = take.repair?.kind === 'lip-sync';
  return (
    <div className={`dir-take${take.accepted ? ' accepted' : ''}${isChild ? ' child' : ''}`}>
      <div className="dir-take-media">
        {src ? <video src={src} controls muted width={140} /> : <div className="dir-take-noresult">{take.status === 'exported' ? 'awaiting external result' : take.status}</div>}
      </div>
      <div className="dir-take-body">
        <div className="dir-take-meta">
          <span className="chip small">{take.provider}</span>
          <span className={`chip small status-${take.status}`}>{take.status}</span>
          {isChild && <span className="chip small">{isLipChild ? 'lip-sync repair' : 'repair'} of {take.parentTakeId!.slice(0, 6)}</span>}
          {take.lipSync !== 'not-required' && <span className={`chip small lip-${take.lipSync}`}>lip: {take.lipSync}</span>}
          {take.error && <span className="dir-warn small">{take.error}</span>}
        </div>
        <div className="dir-take-actions">
          {onCheckStatus && <button className="ghost small" onClick={onCheckStatus}>Check status / resume</button>}
          {isChild && !take.assetId && <button className="primary small" onClick={onGenerateChild} title="Send the source clip + repair direction to the provider's source-video edit path">Generate {isLipChild ? 'lip-sync' : 'repair'} (live)</button>}
          {isChild && !take.assetId && <button className="ghost small" onClick={onExportChild} disabled={!ctx.host.canExportPackets}>Export {isLipChild ? 'lip-sync' : 'repair'} package</button>}
          {!take.assetId && <button className="ghost small" onClick={onImport}>Import result MP4</button>}
          {take.assetId && take.accepted !== true && <button className="primary small" onClick={onAccept}>Accept</button>}
          {take.assetId && <button className="ghost small" onClick={onReject}>Reject</button>}
          {take.assetId && <button className="ghost small" onClick={() => setRepairing((v) => !v)}>Add repair direction</button>}
          {take.assetId && !isChild && <button className="ghost small" onClick={() => setLipping((v) => !v)}>Lip-sync repair…</button>}
        </div>
        {take.assetId && (
          <div className="dir-lipsync-controls">
            <span className="muted small">Lip sync:</span>
            {(['not-required', 'pending', 'passed', 'needs-repair'] as const).map((v) => (
              <button key={v} className={`chip small ${take.lipSync === v ? 'on' : ''}`} onClick={() => onLipSync(v)}>{v}</button>
            ))}
          </div>
        )}
        {lipping && (
          <div className="dir-repair dir-lipsync-panel">
            <p className="muted small">Sync the mouth to the overlapping vocal. Note: the default video provider edits the source clip but does not guarantee exact audio-driven lip-sync — the manual package remains the most faithful path.</p>
            <div className="dir-scene-times">
              <label>From <input type="number" step={0.1} value={lipStart} onChange={(e) => setLipStart(Number(e.target.value))} /></label>
              <label>To <input type="number" step={0.1} value={lipEnd} onChange={(e) => setLipEnd(Number(e.target.value))} /></label>
              <label>Performer
                <select value={lipPerformer} onChange={(e) => setLipPerformer(e.target.value)}>
                  <option value="">—</option>
                  {performers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>
            <button className="ghost small" onClick={() => { onStartLipSync(lipEnd > lipStart ? { start: lipStart, end: lipEnd } : null, lipPerformer || null); setLipping(false); }}>Create lip-sync repair attempt</button>
          </div>
        )}
        {repairing && (
          <div className="dir-repair">
            <input placeholder="preserve (comma-sep: the performance, the camera)" value={preserve} onChange={(e) => setPreserve(e.target.value)} />
            <input placeholder="change (comma-sep: the ending, the tattoos)" value={change} onChange={(e) => setChange(e.target.value)} />
            <input placeholder="note" value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="ghost small" onClick={() => { onRepair(preserve.split(',').map((s) => s.trim()).filter(Boolean), change.split(',').map((s) => s.trim()).filter(Boolean), note); setRepairing(false); }}>Create repair attempt</button>
          </div>
        )}
      </div>
    </div>
  );
}

function PacketInspector({ packet, readiness, onClose }: { packet: GenerationPacket; readiness: ReadinessResult | null; onClose: () => void; host: DirectorCtx['host'] }) {
  return (
    <div className="dir-modal" onClick={onClose}>
      <div className="dir-packet" onClick={(e) => e.stopPropagation()}>
        <div className="dir-packet-head"><h3>Exactly what will be sent</h3><button className="ghost small" onClick={onClose}>Close</button></div>
        <div className="dir-packet-cols">
          <div>
            <h4>Prompt</h4><pre className="dir-pre">{packet.prompt}</pre>
            <h4>Negative constraints</h4><pre className="dir-pre">{packet.negative}</pre>
          </div>
          <div>
            <h4>Reference files ({packet.references.length})</h4>
            <ul className="dir-list">{packet.references.map((r) => <li key={r.referenceId}><code>{r.fileName}</code> — {r.entityName} {r.kind}</li>)}</ul>
            <h4>Timing</h4><div className="muted small">song {fmt(packet.timing.sceneStartSec)}–{fmt(packet.timing.sceneEndSec)} · {packet.timing.durationSec.toFixed(1)}s · {packet.aspect} · {packet.resolution}</div>
            <h4>Identity fingerprints</h4>
            <ul className="dir-list">{Object.entries(packet.entityFingerprints).map(([id, fp]) => <li key={id}><code>{fp}</code></li>)}</ul>
            <h4>Must remain</h4><ul className="dir-list">{packet.preserveRules.map((p) => <li key={p}>{p}</li>)}</ul>
            <h4>Packet files</h4><ul className="dir-list">{packet.files.map((f) => <li key={f.relPath}><code>{f.relPath}</code></li>)}</ul>
            <h4>Provider fit {readiness ? `(${readiness.provider})` : ''}</h4>
            {!readiness || readiness.items.length === 0 ? <div className="muted small">No capability conflicts.</div>
              : readiness.items.map((c) => <div key={c.id} className={`dir-conflict ${c.severity}`}><b>{c.message}</b><div className="dir-conflict-choices">{c.resolutions.map((ch) => <span key={ch} className="chip small">{ch}</span>)}</div></div>)}
            <div className="muted small">Estimated cost: <b>unknown</b> — the provider does not report a reliable per-request price; you control spend by how many scenes you generate.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
