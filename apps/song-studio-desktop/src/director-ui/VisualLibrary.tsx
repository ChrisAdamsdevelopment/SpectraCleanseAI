import { useState } from 'react';
import type { DirectorCtx } from './context';
import {
  makeEntity, makeReference, refreshEntityIdentity, ENTITY_TYPES, REFERENCE_KINDS,
  type DirectorEntity, type EntityType, type ReferenceKind,
} from '../director/model';

// PROJECT VISUAL LIBRARY (DEC-003 §4A): create entities, add references (upload
// or import a generated result), approve/reject variants (a proposal is never
// canonical until approved), lock/vary traits, and see the live identity
// fingerprint/version.

const CAPTURE_GUIDANCE = 'Use a plain contrasting background that clearly separates the subject. Even lighting, sharp focus, no filters. For small details (a tattoo, a ring), add both a close-up and a wider image showing where it belongs.';

export function VisualLibrary({ ctx }: { ctx: DirectorCtx }) {
  const { state, update, host } = ctx;
  const [selId, setSelId] = useState<string | null>(state.entities[0]?.id ?? null);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState<EntityType>('person');
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
    // uploads are approved on arrival; imported generations are proposals.
    ref.approved = origin === 'upload';
    const next = refreshEntityIdentity({ ...entity, references: [...entity.references, ref] });
    replaceEntity(next);
  };

  const toggleApprove = (refId: string) => {
    if (!entity) return;
    const next = refreshEntityIdentity({
      ...entity,
      references: entity.references.map((r) => (r.id === refId ? { ...r, approved: !r.approved } : r)),
    });
    replaceEntity(next);
  };
  const setRefBodyLocation = (refId: string, loc: string) => {
    if (!entity) return;
    replaceEntity({ ...entity, references: entity.references.map((r) => (r.id === refId ? { ...r, bodyLocation: loc } : r)) });
  };
  const removeRef = (refId: string) => {
    if (!entity) return;
    replaceEntity(refreshEntityIdentity({ ...entity, references: entity.references.filter((r) => r.id !== refId) }));
  };
  const editTraits = (which: 'lockedTraits' | 'variableTraits', text: string) => {
    if (!entity) return;
    const arr = text.split('\n').map((s) => s.trim()).filter(Boolean);
    replaceEntity(refreshEntityIdentity({ ...entity, [which]: arr }));
  };
  const approve = () => { if (entity) replaceEntity({ ...entity, approved: true, history: [...entity.history, { at: new Date().toISOString(), event: 'entity approved' }] }); };

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
            <button className={`chip${entity.approved ? ' ok' : ''}`} onClick={approve}>{entity.approved ? 'Approved' : 'Approve entity'}</button>
          </div>

          <label className="dir-field"><span>Description</span>
            <textarea rows={2} value={entity.description} onChange={(e) => replaceEntity({ ...entity, description: e.target.value })} />
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
              <select id="refkind" defaultValue="face">{REFERENCE_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
              <button className="ghost small" onClick={() => addReference((document.getElementById('refkind') as HTMLSelectElement).value as ReferenceKind, 'upload')}>Upload reference</button>
              <button className="ghost small" onClick={() => addReference((document.getElementById('refkind') as HTMLSelectElement).value as ReferenceKind, 'imported-generation')}>Import generated variant</button>
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
                    {(r.kind === 'tattoo-close' || r.kind === 'tattoo-location') && (
                      <input className="dir-ref-loc" placeholder="body location" defaultValue={r.bodyLocation ?? ''} onBlur={(e) => setRefBodyLocation(r.id, e.target.value)} />
                    )}
                    <div className="dir-ref-actions">
                      <button className={`chip${r.approved ? ' ok' : ''}`} onClick={() => toggleApprove(r.id)}>{r.approved ? 'Approved' : 'Approve'}</button>
                      <button className="ghost small" onClick={() => removeRef(r.id)}>Remove</button>
                    </div>
                  </div>
                </div>
              );
            })}
            {entity.references.length === 0 && <div className="muted small">No references yet. Upload identity/tattoo/wardrobe/location images, or import a generated variant to approve.</div>}
          </div>
          <p className="muted small">Approved references and locked traits define the identity fingerprint sent with every scene using this entity. Changing them creates a new version without altering takes already generated.</p>
        </div>
      ) : <div className="dir-entity-detail muted">Create a character, object, or location to begin building your reusable visual world.</div>}
    </div>
  );
}
