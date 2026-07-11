import { useMemo, useState } from 'react';
import type { DirectorCtx } from './context';
import {
  makeScene, orderedScenes, sceneOverlaps, RELATIONSHIP_MEANING,
  type ScenePlan, type SceneCasting, type ContinuityRelationship, type GenerationTake,
} from '../director/model';
import { preflightScene } from '../director/preflight';
import { compileScenePacket, checkProviderFit, type GenerationPacket } from '../director/compile';
import { googleVideoCapabilities } from '../director/providers/googleVideo';
import { ToolFieldRenderer } from './ToolFieldRenderer';
import {
  addTakeFromPacket, bindResultToTake, acceptTake, rejectTake, addRepairAttempt,
  takesForScene, setTakeStatus,
} from '../director/actions';
import { formatTime } from '../lib/time';

function fmt(t: number) { return formatTime(Math.max(0, t)); }

export function SceneBoard({ ctx }: { ctx: DirectorCtx }) {
  const { state, update } = ctx;
  const [selId, setSelId] = useState<string | null>(state.scenes[0]?.id ?? null);
  const scenes = useMemo(() => orderedScenes(state.scenes), [state.scenes]);
  const overlaps = useMemo(() => sceneOverlaps(state.scenes), [state.scenes]);
  const scene = state.scenes.find((s) => s.id === selId) ?? null;
  const dur = ctx.songDurationSec ?? 0;

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
  const conflicts = useMemo(() => preflightScene(scene, state), [scene, state]);
  const takes = takesForScene(state, scene.id);
  const dur = ctx.songDurationSec ?? 0;

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
    setPacket(compileScenePacket(state, scene, { attemptId, recipe: 'separate-references', audioPath: ctx.audioPath }));
  };
  const capabilityConflicts = packet ? checkProviderFit(packet, googleVideoCapabilities) : [];

  const exportPacket = async () => {
    const dir = await host.pickPacketDir(); if (!dir) return;
    setBusy('Exporting package…');
    try {
      const attemptId = crypto?.randomUUID?.() ? '' : ''; // real id assigned via addTakeFromPacket below
      const pk = compileScenePacket(state, scene, { attemptId: 'att-' + Date.now().toString(36), recipe: 'separate-references', audioPath: ctx.audioPath });
      const { state: s2, take } = addTakeFromPacket(state, scene, pk, 'manual');
      const dest = `${dir}/scene-${scene.title.replace(/[^a-z0-9]+/gi, '_')}-${take.id}`;
      // re-stamp the packet's return contract with the real take id
      const realPk = compileScenePacket(s2, scene, { attemptId: take.id, recipe: 'separate-references', audioPath: ctx.audioPath });
      await host.writePacket(realPk, dest);
      update(setTakeStatus(s2, take.id, 'exported'));
      setBusy(`Package written to ${dest}. Generate an MP4 externally, then Import result.`);
      void attemptId;
    } catch (e) { setBusy(`Export failed: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const submitLive = async () => {
    setBusy('Submitting to Google video provider…');
    const pk = compileScenePacket(state, scene, { attemptId: 'att-' + Date.now().toString(36), recipe: 'separate-references', audioPath: ctx.audioPath });
    const { state: s2, take } = addTakeFromPacket(state, scene, pk, 'google-video');
    update(s2);
    const outcome = await host.submitGeneration(pk);
    if (!outcome.ok) { update(setTakeStatus(s2, take.id, 'failed', { error: outcome.blockedReason || outcome.error || 'submit failed' })); setBusy(outcome.blockedReason ? `Live generation blocked: ${outcome.blockedReason} (use Export package instead)` : `Submit failed: ${outcome.error}`); return; }
    update(setTakeStatus(s2, take.id, 'submitted', { submittedAt: new Date().toISOString(), model: googleVideoCapabilities.notes ? 'veo' : null }));
    setBusy(`Submitted (job ${outcome.jobId}). Poll from the take below when ready.`);
  };

  const importResult = async (takeId: string) => {
    const path = await host.pickGeneratedVideo(); if (!path) return;
    const bind = await host.resolveReturnAttempt(path, takeId);
    const boundTake = bind.attemptId && bind.attemptId !== takeId
      ? state.takes.find((t) => t.id === bind.attemptId)?.id ?? takeId
      : takeId;
    const assetId = ctx.addAsset('generated-video', path, `${scene.title} take`);
    update(bindResultToTake(state, boundTake, assetId, 'imported'));
    setBusy(bind.via === 'manifest' ? 'Imported and bound via the package return-manifest.' : 'Imported and bound to this attempt.');
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
                    <ToolFieldRenderer field={f} value={out?.values[f.id]} onChange={(v) => setVal(f.id, v)} />
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
              <div className="dir-conflict-choices">{c.choices.map((ch) => <span key={ch} className="chip small">{ch}</span>)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Compile + generate + export */}
      <div className="dir-generate-bar">
        <button className="ghost small" onClick={compile}>Inspect compiled packet</button>
        <button className="ghost small" onClick={exportPacket} disabled={!ctx.outputDir && !host.toSrc('')}>Export generation package</button>
        <button className="primary small" onClick={submitLive} disabled={conflicts.some((c) => c.severity === 'blocking')}>
          {ctx.host.providerConfigured() ? 'Generate with Google video' : 'Generate (needs API key)'}
        </button>
      </div>
      {busy && <div className="dir-busy small">{busy}</div>}

      {packet && <PacketInspector packet={packet} capabilityConflicts={capabilityConflicts} onClose={() => setPacket(null)} host={host} />}

      {/* Takes */}
      <h4>Takes for this scene</h4>
      <div className="dir-takes">
        {takes.length === 0 && <div className="muted small">No takes yet. Export a package or generate to create the first attempt.</div>}
        {takes.map((t) => (
          <TakeRow key={t.id} ctx={ctx} scene={scene} take={t} onImport={() => importResult(t.id)}
            onAccept={() => update(acceptTake(state, t.id))}
            onReject={() => update(rejectTake(state, t.id))}
            onRepair={(preserve, change, note) => { const { state: s2 } = addRepairAttempt(state, t.id, { preserve, change, intervalSec: null, note }); update(s2); }}
            entityName={(id) => entitiesById[id]?.name ?? id} />
        ))}
      </div>
    </div>
  );
}

function TakeRow({ ctx, take, onImport, onAccept, onReject, onRepair }: {
  ctx: DirectorCtx; scene: ScenePlan; take: GenerationTake;
  onImport: () => void; onAccept: () => void; onReject: () => void;
  onRepair: (preserve: string[], change: string[], note: string) => void; entityName: (id: string) => string;
}) {
  const [repairing, setRepairing] = useState(false);
  const [preserve, setPreserve] = useState(''); const [change, setChange] = useState(''); const [note, setNote] = useState('');
  const src = take.assetId ? ctx.host.toSrc(ctx.assetPath(take.assetId) ?? '') : null;
  return (
    <div className={`dir-take${take.accepted ? ' accepted' : ''}`}>
      <div className="dir-take-media">
        {src ? <video src={src} controls muted width={140} /> : <div className="dir-take-noresult">{take.status === 'exported' ? 'awaiting external result' : take.status}</div>}
      </div>
      <div className="dir-take-body">
        <div className="dir-take-meta">
          <span className="chip small">{take.provider}</span>
          <span className={`chip small status-${take.status}`}>{take.status}</span>
          {take.lipSync !== 'not-required' && <span className={`chip small lip-${take.lipSync}`}>lip: {take.lipSync}</span>}
          {take.error && <span className="dir-warn small">{take.error}</span>}
        </div>
        <div className="dir-take-actions">
          {!take.assetId && <button className="ghost small" onClick={onImport}>Import result MP4</button>}
          {take.assetId && take.accepted !== true && <button className="primary small" onClick={onAccept}>Accept</button>}
          {take.assetId && <button className="ghost small" onClick={onReject}>Reject</button>}
          {take.assetId && <button className="ghost small" onClick={() => setRepairing((v) => !v)}>Add repair direction</button>}
        </div>
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

function PacketInspector({ packet, capabilityConflicts, onClose }: { packet: GenerationPacket; capabilityConflicts: Array<{ id: string; message: string; choices: string[] }>; onClose: () => void; host: DirectorCtx['host'] }) {
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
            <h4>Provider fit (Google video)</h4>
            {capabilityConflicts.length === 0 ? <div className="muted small">No capability conflicts.</div>
              : capabilityConflicts.map((c) => <div key={c.id} className="dir-conflict warning"><b>{c.message}</b><div className="dir-conflict-choices">{c.choices.map((ch) => <span key={ch} className="chip small">{ch}</span>)}</div></div>)}
            <div className="muted small">Estimated cost: <b>unknown</b> — the Google video API does not report a reliable per-request price; you control spend by how many scenes you generate.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
