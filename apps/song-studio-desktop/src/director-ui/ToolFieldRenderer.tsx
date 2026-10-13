import { useRef, useState } from 'react';
import { PoseSequenceEditor } from './PoseSequenceEditor';
import {
  defaultPose, defaultCameraPath, CAMERA_MOVEMENTS,
  type ToolField, type PoseSequenceData, type CameraPathData, type ImageBoardData,
  type ReferencePickData, type LyricBlocksData, type CameraMovementType,
  type LyricEvent, type MouthVisibility,
} from '../director/model';
import { makeOutputId } from '../project/types';

// Renders a single declarative tool field (allowlisted primitives only) and
// writes canonical STRUCTURED output. No field can execute code — a fixed switch
// over known kinds. The rich pickers (reference-picker/image-board/camera-path/
// lyric-blocks) read the project via `env` and store stable ids / normalized
// coordinates so every control affects the compiled packet (no dead controls).

export interface ToolFieldEnv {
  references: Array<{ id: string; label: string; kind: string; path: string; entityName: string }>;
  assets: Array<{ id: string; label: string; path: string }>;
  lyrics: LyricEvent[];
  toSrc: (p: string) => string | null;
}

const EMPTY_ENV: ToolFieldEnv = { references: [], assets: [], lyrics: [], toSrc: () => null };

export function ToolFieldRenderer({ field, value, onChange, env = EMPTY_ENV }: { field: ToolField; value: unknown; onChange: (v: unknown) => void; env?: ToolFieldEnv }) {
  switch (field.kind) {
    case 'text':
      return <textarea className="tool-text" rows={2} value={String(value ?? '')} placeholder={field.help} onChange={(e) => onChange(e.target.value)} />;
    case 'range':
      return (
        <div className="tool-range">
          <input type="range" min={field.min ?? 0} max={field.max ?? 10} step={field.step ?? 1} value={Number(value ?? field.min ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />
          <b>{Number(value ?? field.min ?? 0)}</b>
        </div>
      );
    case 'scale': {
      const labels = field.labels ?? ['low', 'mid', 'high'];
      const idx = typeof value === 'number' ? value : 0;
      return (
        <div className="tool-scale">
          {labels.map((l, i) => <button key={i} className={`chip${idx === i ? ' ok' : ''}`} onClick={() => onChange(i)}>{l}</button>)}
        </div>
      );
    }
    case 'toggle':
      return <label className="tool-toggle"><input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} /> {field.help ?? 'On'}</label>;
    case 'choice':
      return (
        <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          <option value="" disabled>Choose…</option>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'steps': {
      const items = Array.isArray(value) ? (value as string[]) : [''];
      const set = (i: number, v: string) => onChange(items.map((x, k) => (k === i ? v : x)));
      return (
        <div className="tool-steps">
          {items.map((it, i) => <input key={i} value={it} placeholder={`Step ${i + 1}`} onChange={(e) => set(i, e.target.value)} />)}
          <button className="ghost small" disabled={items.length >= (field.maxItems ?? 12)} onClick={() => onChange([...items, ''])}>+ step</button>
        </div>
      );
    }
    case 'preserve-vary': {
      const rows = field.rows ?? [];
      const state = (value && typeof value === 'object' ? value : {}) as Record<string, 'preserve' | 'vary'>;
      return (
        <div className="tool-preserve-vary">
          {rows.map((r) => (
            <div key={r} className="pv-row">
              <span>{r}</span>
              <div className="pv-toggle">
                <button className={state[r] === 'preserve' ? 'on' : ''} onClick={() => onChange({ ...state, [r]: 'preserve' })}>preserve</button>
                <button className={state[r] === 'vary' ? 'on' : ''} onClick={() => onChange({ ...state, [r]: 'vary' })}>may vary</button>
              </div>
            </div>
          ))}
        </div>
      );
    }
    case 'beat-grid': {
      const beats = field.beats ?? 8;
      const on = Array.isArray(value) ? (value as number[]) : [];
      const toggle = (b: number) => onChange(on.includes(b) ? on.filter((x) => x !== b) : [...on, b].sort((a, z) => a - z));
      return (
        <div className="tool-beatgrid">
          {Array.from({ length: beats }, (_, b) => <button key={b} className={`beat${on.includes(b) ? ' on' : ''}`} onClick={() => toggle(b)}>{b + 1}</button>)}
        </div>
      );
    }
    case 'body-map': {
      const regions = field.regions ?? [];
      const on = Array.isArray(value) ? (value as string[]) : [];
      const toggle = (r: string) => onChange(on.includes(r) ? on.filter((x) => x !== r) : [...on, r]);
      return (
        <div className="tool-bodymap">
          {regions.map((r) => <button key={r} className={`chip${on.includes(r) ? ' ok' : ''}`} onClick={() => toggle(r)}>{r}</button>)}
        </div>
      );
    }
    case 'pose-sequence': {
      const pv: PoseSequenceData = value && typeof value === 'object' && 'poses' in (value as object)
        ? (value as PoseSequenceData) : { poses: [{ atBeat: 0, holdBeats: 1, transition: 'smooth', joints: defaultPose() }] };
      return <PoseSequenceEditor value={pv} onChange={onChange} />;
    }
    case 'reference-picker':
      return <ReferencePicker field={field} value={value as ReferencePickData | undefined} onChange={onChange} env={env} />;
    case 'image-board':
      return <ImageBoard value={value as ImageBoardData | undefined} onChange={onChange} env={env} />;
    case 'camera-path':
      return <CameraPathEditor value={value as CameraPathData | undefined} onChange={onChange} />;
    case 'lyric-blocks':
      return <LyricBlocks value={value as LyricBlocksData | undefined} onChange={onChange} env={env} />;
    default:
      return null;
  }
}

// ── reference-picker ─────────────────────────────────────────────────────────
function ReferencePicker({ field, value, onChange, env }: { field: ToolField; value?: ReferencePickData; onChange: (v: ReferencePickData) => void; env: ToolFieldEnv }) {
  const single = field.maxItems === 1;
  const pick = value ?? { referenceIds: [], assetIds: [] };
  const items = [
    ...env.references.map((r) => ({ id: r.id, kind: 'reference' as const, label: `${r.entityName} · ${r.kind}`, path: r.path })),
    ...env.assets.map((a) => ({ id: a.id, kind: 'asset' as const, label: a.label, path: a.path })),
  ];
  const isOn = (id: string, kind: 'reference' | 'asset') => (kind === 'reference' ? pick.referenceIds : pick.assetIds).includes(id);
  const toggle = (id: string, kind: 'reference' | 'asset') => {
    const on = isOn(id, kind);
    if (single) { onChange({ referenceIds: kind === 'reference' && !on ? [id] : [], assetIds: kind === 'asset' && !on ? [id] : [] }); return; }
    if (kind === 'reference') onChange({ ...pick, referenceIds: on ? pick.referenceIds.filter((x) => x !== id) : [...pick.referenceIds, id] });
    else onChange({ ...pick, assetIds: on ? pick.assetIds.filter((x) => x !== id) : [...pick.assetIds, id] });
  };
  if (items.length === 0) return <div className="muted small">No approved references or assets available yet — approve references in the Visual Library.</div>;
  return (
    <div className="tool-refpicker">
      {items.map((it) => {
        const src = env.toSrc(it.path);
        return (
          <button key={`${it.kind}:${it.id}`} className={`tool-refthumb${isOn(it.id, it.kind) ? ' on' : ''}`} onClick={() => toggle(it.id, it.kind)} title={it.label}>
            {src ? <img src={src} alt={it.label} /> : <div className="tool-refthumb-noimg">img</div>}
            <span className="muted small">{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── image-board ──────────────────────────────────────────────────────────────
function ImageBoard({ value, onChange, env }: { value?: ImageBoardData; onChange: (v: ImageBoardData) => void; env: ToolFieldEnv }) {
  const board = value ?? { items: [] };
  const [addId, setAddId] = useState('');
  const available = [
    ...env.references.map((r) => ({ key: `reference:${r.id}`, label: `${r.entityName} · ${r.kind}`, path: r.path })),
    ...env.assets.map((a) => ({ key: `asset:${a.id}`, label: a.label, path: a.path })),
  ];
  const add = () => {
    if (!addId) return;
    const [kind, id] = addId.split(':');
    const item = { id: makeOutputId(), label: '', ...(kind === 'reference' ? { referenceId: id } : { assetId: id }) };
    onChange({ items: [...board.items, item] }); setAddId('');
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d; if (j < 0 || j >= board.items.length) return;
    const next = [...board.items]; [next[i], next[j]] = [next[j], next[i]]; onChange({ items: next });
  };
  const pathFor = (it: ImageBoardData['items'][number]) => {
    if (it.referenceId) return env.references.find((r) => r.id === it.referenceId)?.path ?? null;
    if (it.assetId) return env.assets.find((a) => a.id === it.assetId)?.path ?? null;
    return null;
  };
  return (
    <div className="tool-imageboard">
      <div className="tool-imageboard-cards">
        {board.items.map((it, i) => {
          const src = pathFor(it) ? env.toSrc(pathFor(it)!) : null;
          return (
            <div key={it.id} className="tool-board-card">
              {src ? <img src={src} alt="" /> : <div className="tool-refthumb-noimg">img</div>}
              <input placeholder="purpose / label" value={it.label} onChange={(e) => onChange({ items: board.items.map((x) => (x.id === it.id ? { ...x, label: e.target.value } : x)) })} />
              <div className="tool-board-ops">
                <button className="ghost small" onClick={() => move(i, -1)} disabled={i === 0}>↑</button>
                <button className="ghost small" onClick={() => move(i, 1)} disabled={i === board.items.length - 1}>↓</button>
                <button className="ghost small" onClick={() => onChange({ items: board.items.filter((x) => x.id !== it.id) })}>×</button>
              </div>
            </div>
          );
        })}
        {board.items.length === 0 && <div className="muted small">Empty board — add reference/asset images and label each one's purpose.</div>}
      </div>
      <div className="tool-imageboard-add">
        <select value={addId} onChange={(e) => setAddId(e.target.value)}>
          <option value="">add image…</option>
          {available.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
        </select>
        <button className="ghost small" onClick={add} disabled={!addId}>+ add</button>
      </div>
    </div>
  );
}

// ── camera-path (SVG editor over the normalized frame) ───────────────────────
function CameraPathEditor({ value, onChange }: { value?: CameraPathData; onChange: (v: CameraPathData) => void }) {
  const cp = value ?? defaultCameraPath();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ kind: 'start' | 'end' | 'control'; i?: number } | null>(null);
  const at = (e: React.PointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    return { x: +Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)).toFixed(3), y: +Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)).toFixed(3) };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag || !svgRef.current) return;
    const p = at(e);
    if (drag.kind === 'start') onChange({ ...cp, start: p });
    else if (drag.kind === 'end') onChange({ ...cp, end: p });
    else if (drag.kind === 'control' && drag.i !== undefined) onChange({ ...cp, control: cp.control.map((c, i) => (i === drag.i ? p : c)) });
  };
  const pts = [cp.start, ...cp.control, cp.end];
  const poly = pts.map((p) => `${p.x * 100},${p.y * 100}`).join(' ');
  return (
    <div className="tool-camerapath">
      <svg ref={svgRef} className="camerapath-svg" viewBox="0 0 100 100" onPointerMove={onMove} onPointerUp={() => setDrag(null)} onPointerLeave={() => setDrag(null)}>
        <rect x={0} y={0} width={100} height={100} fill="none" stroke="var(--border,#333)" strokeWidth={0.6} />
        <polyline points={poly} fill="none" stroke="var(--accent,#6ea8fe)" strokeWidth={1.2} strokeDasharray="2 2" />
        <circle cx={cp.start.x * 100} cy={cp.start.y * 100} r={3} fill="#4caf50" onPointerDown={() => setDrag({ kind: 'start' })} style={{ cursor: 'grab' }} />
        {cp.control.map((c, i) => <circle key={i} cx={c.x * 100} cy={c.y * 100} r={2.4} fill="var(--accent,#6ea8fe)" onPointerDown={() => setDrag({ kind: 'control', i })} style={{ cursor: 'grab' }} />)}
        <circle cx={cp.end.x * 100} cy={cp.end.y * 100} r={3} fill="#e53935" onPointerDown={() => setDrag({ kind: 'end' })} style={{ cursor: 'grab' }} />
      </svg>
      <div className="tool-camerapath-controls">
        <label>Movement
          <select value={cp.movement} onChange={(e) => onChange({ ...cp, movement: e.target.value as CameraMovementType })}>
            {CAMERA_MOVEMENTS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <input placeholder="facing / orientation (e.g. toward subject)" value={cp.orientation} onChange={(e) => onChange({ ...cp, orientation: e.target.value })} />
        <button className="ghost small" onClick={() => onChange({ ...cp, control: [...cp.control, { x: 0.5, y: 0.5 }] })} disabled={cp.control.length >= 4}>+ control point</button>
        <button className="ghost small" onClick={() => onChange({ ...cp, control: cp.control.slice(0, -1) })} disabled={cp.control.length === 0}>− control point</button>
      </div>
      <p className="muted small">Green = start, red = end. Drag to shape the camera move; it compiles into camera direction.</p>
    </div>
  );
}

// ── lyric-blocks (scene-overlapping timed lyrics) ────────────────────────────
function LyricBlocks({ value, onChange, env }: { value?: LyricBlocksData; onChange: (v: LyricBlocksData) => void; env: ToolFieldEnv }) {
  const data = value ?? { selectedLyricIds: [], overrides: {} };
  const toggle = (id: string) => {
    const on = data.selectedLyricIds.includes(id);
    onChange({ ...data, selectedLyricIds: on ? data.selectedLyricIds.filter((x) => x !== id) : [...data.selectedLyricIds, id] });
  };
  const setOverride = (id: string, patch: { mouthVisibility?: MouthVisibility; emphasis?: number }) =>
    onChange({ ...data, overrides: { ...data.overrides, [id]: { ...data.overrides[id], ...patch } } });
  if (env.lyrics.length === 0) return <div className="muted small">No lyrics overlap this scene. Add timed lyrics in the Lyrics tab.</div>;
  return (
    <div className="tool-lyricblocks">
      {env.lyrics.map((l) => {
        const on = data.selectedLyricIds.includes(l.id);
        const ov = data.overrides[l.id] ?? {};
        return (
          <div key={l.id} className={`tool-lyricblock${on ? ' on' : ''}`}>
            <button className={`chip small${on ? ' ok' : ''}`} onClick={() => toggle(l.id)}>{l.word}</button>
            {on && (
              <div className="tool-lyricblock-ov">
                <select value={ov.mouthVisibility ?? l.mouthVisibility} onChange={(e) => setOverride(l.id, { mouthVisibility: e.target.value as MouthVisibility })} title="mouth visibility override">
                  {(['required', 'preferred', 'off-camera', 'none'] as const).map((m) => <option key={m} value={m}>mouth: {m}</option>)}
                </select>
                <input type="range" min={0} max={1} step={0.05} value={ov.emphasis ?? l.emphasis} onChange={(e) => setOverride(l.id, { emphasis: Number(e.target.value) })} title="emphasis override" />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
