import type { Layer, BackgroundLayer, CoverLayer, TitleLayer, WaveformLayer } from '../render/types';
import { LAYER_LABELS } from '../render/composition';

export function Inspector({ layer, onChange }: { layer: Layer | undefined; onChange: (patch: Partial<Layer>) => void }) {
  if (!layer) return <div className="inspector"><p className="muted">Select a layer to edit it.</p></div>;
  return (
    <div className="inspector">
      <div className="insp-head">{LAYER_LABELS[layer.type] ?? layer.type}</div>
      <Toggle label="Visible" value={layer.visible} onChange={(v) => onChange({ visible: v })} />
      <Range label="Opacity" min={0} max={1} step={0.05} value={layer.opacity} onChange={(v) => onChange({ opacity: v })} />
      {renderTypeControls(layer, onChange)}
    </div>
  );
}

function renderTypeControls(layer: Layer, onChange: (patch: Partial<Layer>) => void) {
  switch (layer.type) {
    case 'background': {
      const l = layer as BackgroundLayer;
      return (<>
        <Range label="Zoom" min={0} max={0.5} step={0.02} value={l.zoom} onChange={(v) => onChange({ zoom: v })} />
        <Range label="Blur" min={0} max={30} step={1} value={l.blur} onChange={(v) => onChange({ blur: v })} />
        <Range label="Darkness / brightness" min={-0.5} max={0.1} step={0.02} value={l.brightness} onChange={(v) => onChange({ brightness: v })} />
        <Range label="Saturation" min={0.4} max={1.6} step={0.05} value={l.saturation} onChange={(v) => onChange({ saturation: v })} />
        <p className="muted small">Background uses the cover art for now.</p>
      </>);
    }
    case 'cover_art': {
      const l = layer as CoverLayer;
      return (<>
        <Range label="Size" min={0.4} max={1.0} step={0.02} value={l.scale} onChange={(v) => onChange({ scale: v })} />
        <Range label="Position X" min={0} max={1} step={0.01} value={l.x} onChange={(v) => onChange({ x: v })} />
        <Range label="Position Y" min={0} max={1} step={0.01} value={l.y} onChange={(v) => onChange({ y: v })} />
        <Select label="Shape" value={l.shape} options={['square', 'rounded', 'circle']} onChange={(v) => onChange({ shape: v as CoverLayer['shape'] })} />
        <Range label="Shadow" min={0} max={1} step={0.05} value={l.shadow} onChange={(v) => onChange({ shadow: v })} />
      </>);
    }
    case 'title_text': {
      const l = layer as TitleLayer;
      return (<>
        <Text label="Text" value={l.text} onChange={(v) => onChange({ text: v })} />
        <Range label="Size" min={24} max={140} step={2} value={l.size} onChange={(v) => onChange({ size: v })} />
        <Range label="Position Y" min={0.5} max={0.97} step={0.01} value={l.y} onChange={(v) => onChange({ y: v })} />
        <Color label="Color" value={l.color} onChange={(v) => onChange({ color: v })} />
        <Toggle label="Background box" value={l.box} onChange={(v) => onChange({ box: v })} />
        <Range label="Box opacity" min={0} max={1} step={0.05} value={l.boxOpacity} onChange={(v) => onChange({ boxOpacity: v })} />
        <Select label="Alignment" value={l.align} options={['left', 'center', 'right']} onChange={(v) => onChange({ align: v as TitleLayer['align'] })} />
      </>);
    }
    case 'waveform': {
      const l = layer as WaveformLayer;
      return <Select label="Color" value={l.color} options={['white', '0x4fd1ff', '0xff5a5a']} onChange={(v) => onChange({ color: v })} />;
    }
    default:
      return null;
  }
}

function Range({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label className="ctl">
      <span>{label}<b>{round(value)}</b></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="ctl row2">
      <span>{label}</span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="ctl row2">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="ctl row2">
      <span>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="ctl">
      <span>{label}</span>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
function round(n: number) { return Math.round(n * 100) / 100; }
