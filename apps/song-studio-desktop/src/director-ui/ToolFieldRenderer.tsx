import { PoseSequenceEditor } from './PoseSequenceEditor';
import { defaultPose, type ToolField, type PoseSequenceData } from '../director/model';

// Renders a single declarative tool field (allowlisted primitives only) and
// writes canonical structured output. No field can execute code — this is a
// fixed switch over known kinds; unknown kinds never reach here (validated).

export function ToolFieldRenderer({ field, value, onChange }: { field: ToolField; value: unknown; onChange: (v: unknown) => void }) {
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
    case 'image-board':
    case 'camera-path':
    case 'lyric-blocks':
      // These reference project assets; in v1 they capture a text intent that
      // still compiles (honest: no dead control). Richer pickers are additive.
      return <textarea className="tool-text" rows={2} value={String(value ?? '')} placeholder={`${field.kind}: describe your intent`} onChange={(e) => onChange(e.target.value)} />;
    default:
      return null;
  }
}
