import { useMemo, useState } from 'react';
import type { DirectorCtx } from './context';
import {
  makeEntity, makeReference, makeReferenceRequest, refreshEntityIdentity,
  ENTITY_TYPES, REFERENCE_KINDS,
  type DirectorEntity, type EntityType, type ReferenceKind, type ReferenceRequest,
} from '../director/model';
import { applyEntityIdentity } from '../director/actions';
import {
  buildReferencePrompt, assessImageReadiness, setReferenceRequest, applyReferenceSubmit,
  applyReferencePoll, addProposedVariant, approveProposedVariant, rejectProposedVariant,
  compileReferencePackage,
} from '../director/referenceGen';

// PROJECT VISUAL LIBRARY (DEC-003 §4A, VIDEO-003B §1): create entities, add
// references (upload / import / AI-generate), approve/reject variants (a
// proposal is NEVER canonical until approved through the apply transaction),
// lock/vary traits, and see the live identity fingerprint/version. The general
// "Generate reference variant" system covers face/profile/hair/tattoo/wardrobe/
// jewelry/prop/architecture/material/lighting/style/first-frame/final-frame — one
// request system, not one hardcoded feature per kind.

const CAPTURE_GUIDANCE = 'Use a plain contrasting background that clearly separates the subject. Even lighting, sharp focus, no filters. For small details (a tattoo, a ring), add both a close-up and a wider image showing where it belongs.';

export function VisualLibrary({ ctx }: { ctx: DirectorCtx }) {
  const { state, update, host } = ctx;
  const [selId, setSelId] = useState<string | null>(state.entities[0]?.id ?? null);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<EntityType>('person');
  const [refKind, setRefKind] = useState<ReferenceKind>('face');
  const entity = state.entities.find((e) => e.id === selId) ?? null;

  const replaceEntity = (e: DirectorEntity) => update({ ...state, entities: state.entities.map((x) => (x.id === e.id ? e : x)) });

  const createEntity = () => {
    if (!newName.trim()) return;
    const e = makeEntity(newName.trim(), newType);
    update({ ...state, entities: [...state.entities, e] });
    setSelId(e.id); setNewName('');
  };

  const addReference = async (kind: ReferenceKind, origin: 'upload' | 'imported-generation') => {
    if (!entity) return;
    const path = await host.pickReferenceImage();
    if (!path) return;
    const label = path.split(/[\\/]/).pop() || kind;
    const ref = makeReference(entity.id, kind, path, label, origin);
    ref.approved = origin === 'upload';                       // imports arrive as proposals
    const next = refreshEntityIdentity({ ...entity, references: [...entity.references, ref] });
    replaceEntity(next);
  };

  // Approval / rejection flow through the canonical apply transaction (§H1): the
  // version + fingerprint advance ONCE and prior takes keep their fingerprint.
  const toggleApprove = (refId: string) => {
    if (!entity) return;
    const ref = entity.references.find((r) => r.id === refId);
    if (!ref) return;
    const references = entity.references.map((r) => (r.id === refId ? { ...r, approved: !r.approved } : r));
    update(applyEntityIdentity(state, entity.id, { references }));
  };
  const setRefBodyLocation = (refId: string, loc: string) => {
    if (!entity) return;
    replaceEntity({ ...entity, references: entity.references.map((r) => (r.id === refId ? { ...r, bodyLocation: loc } : r)) });
  };
  const removeRef = (refId: string) => {
    if (!entity) return;
    const ref = entity.references.find((r) => r.id === refId);
    // Removing an unapproved proposal never changes identity; removing an
    // approved reference does (apply transaction handles the version bump).
    if (ref && !ref.approved) update(rejectProposedVariant(state, entity.id, refId));
    else update(applyEntityIdentity(state, entity.id, { references: entity.references.filter((r) => r.id !== refId) }));
  };
  const editTraits = (which: 'lockedTraits' | 'variableTraits', text: string) => {
    if (!entity) return;
    const arr = text.split('\n').map((s) => s.trim()).filter(Boolean);
    update(applyEntityIdentity(state, entity.id, { [which]: arr }));
  };
  const approveEntity = () => { if (entity) update(applyEntityIdentity(state, entity.id, { approved: true })); };

  return (
    <div className="dir-library">
      <div className="dir-entity-list">
        <h4>Visual library</h4>
        {state.entities.map((e) => (
          <button key={e.id} className={`dir-entity${e.id === selId ? ' on' : ''}`} onClick={() => setSelId(e.id)}>
            <b>{e.name}</b><span>{e.type}{e.approved ? ' · approved' : ' · draft'}</span>
          </button>
        ))}
        <div className="dir-new-entity">
          <input placeholder="New character / object / location…" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <select value={newType} onChange={(e) => setNewType(e.target.value as EntityType)}>
            {ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="ghost small" onClick={createEntity}>Add</button>
        </div>
      </div>

      {entity ? (
        <div className="dir-entity-detail">
          <div className="dir-entity-head">
            <div>
              <h3>{entity.name} <span className="muted small">({entity.type})</span></h3>
              <div className="dir-fingerprint">identity <code>{entity.activeFingerprint}</code> · version {entity.version}</div>
            </div>
            <button className={`chip${entity.approved ? ' ok' : ''}`} onClick={approveEntity}>{entity.approved ? 'Approved' : 'Approve entity'}</button>
          </div>

          <label className="dir-field"><span>Description</span>
            <textarea rows={2} value={entity.description} onChange={(e) => replaceEntity({ ...entity, description: e.target.value })} onBlur={(e) => update(applyEntityIdentity(state, entity.id, { description: e.target.value }))} />
          </label>
          <div className="dir-traits">
            <label className="dir-field"><span>Must remain the same (locked)</span>
              <textarea rows={2} placeholder="one per line" defaultValue={entity.lockedTraits.join('\n')} onBlur={(e) => editTraits('lockedTraits', e.target.value)} />
            </label>
            <label className="dir-field"><span>May vary</span>
              <textarea rows={2} placeholder="one per line" defaultValue={entity.variableTraits.join('\n')} onBlur={(e) => editTraits('variableTraits', e.target.value)} />
            </label>
          </div>

          <div className="dir-refs-head">
            <h4>References</h4>
            <div className="dir-ref-add">
              <select value={refKind} onChange={(e) => setRefKind(e.target.value as ReferenceKind)}>{REFERENCE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
              <button className="ghost small" onClick={() => addReference(refKind, 'upload')}>Upload reference</button>
              <button className="ghost small" onClick={() => addReference(refKind, 'imported-generation')}>Import generated variant</button>
            </div>
          </div>
          <p className="muted small">{CAPTURE_GUIDANCE}</p>
          <div className="dir-ref-grid">
            {entity.references.map((r) => {
              const src = host.toSrc(r.path);
              return (
                <div key={r.id} className={`dir-ref${r.approved ? ' approved' : ''}`}>
                  {src ? <img src={src} alt={r.kind} /> : <div className="dir-ref-noimg">image</div>}
                  <div className="dir-ref-meta">
                    <b>{r.kind}</b>
                    <span className="muted small">{r.origin}{r.approved ? ' · canonical' : ' · proposal'}</span>
                    {r.provenance.generationAttemptId && <span className="muted small">generated · attempt {r.provenance.generationAttemptId.slice(0, 6)}</span>}
                    {(r.kind === 'tattoo-close' || r.kind === 'tattoo-location') && (
                      <input className="dir-ref-loc" placeholder="body location" defaultValue={r.bodyLocation ?? ''} onBlur={(e) => setRefBodyLocation(r.id, e.target.value)} />
                    )}
                    <div className="dir-ref-actions">
                      <button className={`chip${r.approved ? ' ok' : ''}`} onClick={() => toggleApprove(r.id)}>{r.approved ? 'Approved' : 'Approve'}</button>
                      <button className="ghost small" onClick={() => removeRef(r.id)}>{r.approved ? 'Remove' : 'Reject'}</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {entity.references.length === 0 && <div className="muted small">No references yet. Upload identity/tattoo/wardrobe/location images, import a generated variant, or generate one below.</div>}
          </div>

          <ReferenceGenPanel ctx={ctx} entity={entity} />

          <p className="muted small">Approved references and locked traits define the identity fingerprint sent with every scene using this entity. Changing them creates a new version without altering takes already generated.</p>
        </div>
      ) : <div className="dir-entity-detail muted">Create a character, object, or location to begin building your reusable visual world.</div>}
    </div>
  );
}

// ── Generate reference variant (one general request system, §1) ──────────────
function ReferenceGenPanel({ ctx, entity }: { ctx: DirectorCtx; entity: DirectorEntity }) {
  const { state, update, host } = ctx;
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ReferenceKind>('face');
  const [direction, setDirection] = useState('');
  const [count, setCount] = useState(1);
  const [selectedCond, setSelectedCond] = useState<string[]>(entity.references.filter((r) => r.approved).map((r) => r.id));
  const [busy, setBusy] = useState('');
  const providerId = host.selectedImageProviderId();               // may be 'auto'
  const resolvedImageProvider = host.resolvedImageProviderId();     // concrete
  const caps = host.imageProviderCapabilities();
  const approvedRefs = entity.references.filter((r) => r.approved);
  const requests = state.referenceRequests.filter((r) => r.entityId === entity.id);

  const draft: ReferenceRequest = useMemo(() => ({
    ...makeReferenceRequest(entity, kind, providerId),
    direction, outputCount: count, conditioningReferenceIds: selectedCond,
  }), [entity, kind, providerId, direction, count, selectedCond]);
  const readiness = assessImageReadiness(draft, caps);
  const promptPreview = buildReferencePrompt(entity, draft);
  const canGenerate = readiness.blocking.length === 0;

  const persist = (req: ReferenceRequest) => update(setReferenceRequest(state, req));

  const generateLive = async () => {
    if (!canGenerate) { setBusy('Resolve the highlighted conditioning limit first.'); return; }
    // Record the CONCRETE resolved provider (never 'auto') so polling/resume is
    // take-scoped even if the selection changes later.
    const reqProvider = resolvedImageProvider;
    const req: ReferenceRequest = { ...draft, providerId: reqProvider, status: 'submitted' };
    const withReq: ReferenceRequest[] = [...state.referenceRequests, req];
    const base = { ...state, referenceRequests: withReq };
    persist(req);
    const condPaths = selectedCond.map((cid) => approvedRefs.find((r) => r.id === cid)?.path).filter((p): p is string => Boolean(p));
    setBusy('Requesting reference variant…');
    const out = await host.submitReferenceGeneration(promptPreview, condPaths, count, entity.type === 'person' ? '9:16' : '1:1');
    const usedProvider = out.providerId ?? reqProvider;
    if (!out.ok) {
      update(applyReferenceSubmit(base, req.id, { providerId: usedProvider, modelId: null, jobId: null, phase: 'failed', error: out.blockedReason || out.error || 'submit failed' }));
      setBusy(out.blockedReason ? `Reference generation blocked: ${out.blockedReason} (use Export request instead)` : `Failed: ${out.error}`);
      return;
    }
    const s = applyReferenceSubmit(base, req.id, { providerId: usedProvider, modelId: usedProvider, jobId: out.jobId ?? null, phase: 'submitted' });
    update(s);
    setBusy(`Submitted (job ${out.jobId}). Checking…`);
    await pollRequest(req.id, s);
  };

  const pollRequest = async (requestId: string, from = state) => {
    const req = from.referenceRequests.find((r) => r.id === requestId);
    if (!req?.jobId) { setBusy('No image job to check.'); return; }
    setBusy('Checking reference generation…');
    const res = await host.pollReferenceGeneration(req.jobId, req.providerId);
    if (res.phase === 'succeeded' && res.resultPaths?.length) {
      let s = from;
      for (const p of res.resultPaths) s = addProposedVariant(s, requestId, p, { origin: 'ai-generated' }).state;
      s = applyReferencePoll(s, requestId, { phase: 'succeeded' });
      update(s);
      setBusy(`${res.resultPaths.length} proposal(s) added — approve the ones you want to make canonical.`);
    } else if (res.phase === 'failed') {
      update(applyReferencePoll(from, requestId, { phase: 'failed', error: res.error }));
      setBusy(`Generation failed: ${res.error ?? 'unknown error'}`);
    } else {
      update(applyReferencePoll(from, requestId, { phase: 'running' }));
      setBusy('Still generating — check again in a moment.');
    }
  };

  const exportRequest = async () => {
    if (!host.canExportPackets) { setBusy('Export needs the desktop app.'); return; }
    const dir = await host.pickPacketDir(); if (!dir) return;
    const req: ReferenceRequest = { ...draft, providerId: 'manual', status: 'exported' };
    const { files } = compileReferencePackage({ ...state, referenceRequests: [...state.referenceRequests, req] }, req);
    const dest = `${dir}/refreq-${entity.name.replace(/[^a-z0-9]+/gi, '_')}-${req.id}`;
    setBusy('Exporting reference request…');
    try {
      await host.writeFiles(files, dest);
      update(setReferenceRequest(state, req));
      setBusy(`Request written to ${dest}. Generate externally, then Import generated variant above.`);
    } catch (e) { setBusy(`Export failed: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const importInto = async (requestId: string) => {
    const path = await host.pickReferenceImage(); if (!path) return;
    update(addProposedVariant(state, requestId, path, { origin: 'imported-generation' }).state);
    setBusy('Imported as a proposal — approve it to make it canonical.');
  };

  return (
    <div className="dir-refgen">
      <button className="ghost small" onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'Generate reference variant'}</button>
      {open && (
        <div className="dir-refgen-body">
          <div className="dir-grid2">
            <label className="dir-field"><span>What kind of reference?</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as ReferenceKind)}>{REFERENCE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
            </label>
            <label className="dir-field"><span>Variants</span><input type="number" min={1} max={caps.maxOutputs} value={count} onChange={(e) => setCount(Math.max(1, Number(e.target.value)))} /></label>
          </div>
          <label className="dir-field"><span>Direction</span><textarea rows={2} placeholder="e.g. 3/4 view from the left, softer window light, calm expression" value={direction} onChange={(e) => setDirection(e.target.value)} /></label>
          <div className="dir-field"><span className="muted small">Identity to preserve (approved references)</span>
            <div className="dir-cast-refs">
              {approvedRefs.map((r) => (
                <label key={r.id} className={`chip small${selectedCond.includes(r.id) ? ' ok' : ''}`}>
                  <input type="checkbox" checked={selectedCond.includes(r.id)} onChange={(e) => setSelectedCond((c) => e.target.checked ? [...c, r.id] : c.filter((x) => x !== r.id))} /> {r.kind}
                </label>
              ))}
              {approvedRefs.length === 0 && <span className="muted small">No approved references to condition on yet — you can still generate from the description.</span>}
            </div>
          </div>
          <label className="dir-provider-select">Image provider
            <select value={providerId} onChange={(e) => { host.setImageProvider(e.target.value); update({ ...state }); }}>
              {host.imageProviders().map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          {readiness.items.length > 0 && readiness.items.map((it) => (
            <div key={it.id} className={`dir-conflict ${it.severity}`}><b>{it.message}</b><div className="dir-conflict-choices">{it.resolutions.map((r) => <span key={r} className="chip small">{r}</span>)}</div></div>
          ))}
          <details className="dir-refgen-prompt"><summary>Exact prompt</summary><pre className="dir-pre">{promptPreview}</pre></details>
          <div className="dir-generate-bar">
            <button className="ghost small" onClick={exportRequest} disabled={!host.canExportPackets}>Export request package</button>
            <button className="primary small" onClick={generateLive} disabled={!canGenerate}>Generate variant{count > 1 ? 's' : ''}</button>
          </div>
          {busy && <div className="dir-busy small">{busy}</div>}
          {requests.length > 0 && (
            <div className="dir-refreq-list">
              {requests.map((r) => (
                <div key={r.id} className="dir-refreq">
                  <span className="chip small">{r.kind}</span>
                  <span className={`chip small status-${r.status}`}>{r.status}</span>
                  <span className="muted small">{r.resultRefIds.length} proposal(s)</span>
                  {r.jobId && (r.status === 'submitted' || r.status === 'running') && <button className="ghost small" onClick={() => pollRequest(r.id)}>Check status</button>}
                  <button className="ghost small" onClick={() => importInto(r.id)}>Import result</button>
                  {r.error && <span className="dir-warn small">{r.error}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Approve/reject helpers exported for direct use by scene-level flows if needed.
export { approveProposedVariant, rejectProposedVariant };
