import type { Layer, BackgroundLayer, CoverLayer, TitleLayer, WaveformLayer } from '../render/types';
import { LAYER_LABELS } from '../render/composition';
import { FONT_FAMILIES } from '../lib/fonts';
import { COLOR_PRESETS, colorName } from '../lib/colors';

export type InspectorMode = 'simple' | 'advanced';

// Simple mode shows only the few controls that visibly matter; Advanced reveals
// the rest. Position is primarily set by dragging in the preview.
export function Inspector({ layer, mode, onChange }: { layer: Layer | undefined; mode: InspectorMode; onChange: (patch: Partial<Layer>) => void }) {
  if (!layer) return <div className="inspector"><p className="muted">Click a layer in the preview to edit it.</p></div>;
  const adv = mode === 'advanced';
  return (
    <div className="inspector">
      <div className="insp-head">{LAYER_LABELS[layer.type] ?? layer.type}</div>
      <Toggle label="Visible" value={layer.visible} onChange={(v) => onChange({ visible: v })} />
      {simpleControls(layer, onChange)}
      {adv && advancedControls(layer, onChange)}
    </div>
  );
}

function simpleControls(layer: Layer, onChange: (patch: Partial<Layer>) => void) {
  switch (layer.type) {
    case 'background': {
      const l = layer as BackgroundLayer;
      return (<>
        <Range label="Darkness" min={-0.5} max={0.1} step={0.02} value={l.brightness} onChange={(v) => onChange({ brightness: v })} />
        <Range label="Blur" min={0} max={30} step={1} value={l.blur} onChange={(v) => onChange({ blur: v })} />
      </>);
    }
    case 'cover_art': {
      const l = layer as CoverLayer;
      return (<>
        <Range label="Size" min={0.4} max={1.0} step={0.02} value={l.scale} onChange={(v) => onChange({ scale: v })} />
        <Select label="Shape" value={l.shape} options={[['square', 'Square'], ['rounded', 'Rounded'], ['circle', 'Circle']]} onChange={(v) => onChange({ shape: v as CoverLayer['shape'] })} />
        <p className="muted small">Drag the cover in the preview to position it.</p>
      </>);
    }
    case 'title_text': {
      const l = layer as TitleLayer;
      return (<>
        <Text label="Text" value={l.text} onChange={(v) => onChange({ text: v })} />
        <Select label="Font" value={l.font} options={FONT_FAMILIES.map((f) => [f.id, f.label])} onChange={(v) => onChange({ font: v })} />
        <Color label="Color" value={l.color} onChange={(v) => onChange({ color: v })} />
        <Range label="Size" min={24} max={150} step={2} value={l.size} onChange={(v) => onChange({ size: v })} />
        <p className="muted small">Drag the title in the preview to position it.</p>
      </>);
    }
    case 'waveform': {
      const l = layer as WaveformLayer;
      return <Color label="Color" value={l.color} onChange={(v) => onChange({ color: v })} />;
    }
    default:
      return null;
  }
}

function advancedControls(layer: Layer, onChange: (patch: Partial<Layer>) => void) {
  const opacity = <Range label="Opacity" min={0} max={1} step={0.05} value={layer.opacity} onChange={(v) => onChange({ opacity: v })} />;
  switch (layer.type) {
    case 'background': {
      const l = layer as BackgroundLayer;
      return (<><div className="adv-sep">Advanced</div>
        <Range label="Zoom" min={0} max={0.5} step={0.02} value={l.zoom} onChange={(v) => onChange({ zoom: v })} />
        <Range label="Saturation" min={0.4} max={1.6} step={0.05} value={l.saturation} onChange={(v) => onChange({ saturation: v })} />
        {opacity}
      </>);
    }
    case 'cover_art': {
      const l = layer as CoverLayer;
      return (<><div className="adv-sep">Advanced</div>
        <Range label="Position X" min={0} max={1} step={0.01} value={l.x} onChange={(v) => onChange({ x: v })} />
        <Range label="Position Y" min={0} max={1} step={0.01} value={l.y} onChange={(v) => onChange({ y: v })} />
        <Range label="Shadow (preview only)" min={0} max={1} step={0.05} value={l.shadow} onChange={(v) => onChange({ shadow: v })} />
        {opacity}
      </>);
    }
    case 'title_text': {
      const l = layer as TitleLayer;
      return (<><div className="adv-sep">Advanced</div>
        <Range label="Position X" min={0} max={1} step={0.01} value={l.x} onChange={(v) => onChange({ x: v })} />
        <Range label="Position Y" min={0} max={1} step={0.01} value={l.y} onChange={(v) => onChange({ y: v })} />
        <Select label="Alignment" value={l.align} options={[['left', 'Left'], ['center', 'Center'], ['right', 'Right']]} onChange={(v) => onChange({ align: v as TitleLayer['align'] })} />
        <Toggle label="Background box" value={l.box} onChange={(v) => onChange({ box: v })} />
        <Range label="Box opacity" min={0} max={1} step={0.05} value={l.boxOpacity} onChange={(v) => onChange({ boxOpacity: v })} />
        {opacity}
      </>);
    }
    case 'waveform': {
      const l = layer as WaveformLayer;
      return (<><div className="adv-sep">Advanced</div>
        <Range label="Position Y" min={0.3} max={0.95} step={0.01} value={l.y} onChange={(v) => onChange({ y: v })} />
        {opacity}
        <p className="muted small">Preview waveform is approximate; export uses the real audio waveform.</p>
      </>);
    }
    default:
      return null;
  }
}

function Range({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (<label className="ctl"><span>{label}<b>{round(value)}</b></span><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} /></label>);
}
function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (<label className="ctl row2"><span>{label}</span><input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} /></label>);
}
function Select({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (v: string) => void }) {
  return (<label className="ctl row2"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, lbl]) => <option key={v} value={v}>{lbl}</option>)}</select></label>);
}
function Text({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (<label className="ctl"><span>{label}</span><input type="text" value={value} onChange={(e) => onChange(e.target.value)} /></label>);
}
function Color({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="ctl"><span>{label}<b>{colorName(value)}</b></span>
      <div className="swatches">
        {COLOR_PRESETS.map((c) => (<button key={c.value} title={c.name} onClick={() => onChange(c.value)} className={`swatch${c.value.toLowerCase() === value.toLowerCase() ? ' on' : ''}`} style={{ background: c.value }} />))}
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} title="Custom" />
      </div>
    </div>
  );
}
function round(n: number) { return Math.round(n * 100) / 100; }
