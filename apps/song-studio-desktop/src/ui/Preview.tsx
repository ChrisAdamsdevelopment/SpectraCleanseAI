import type { MouseEvent } from 'react';
import type { Composition, BackgroundLayer, CoverLayer, TitleLayer, WaveformLayer, EffectLayer } from '../render/types';
import { getLayer } from '../render/composition';

// Live DOM/CSS approximation of the composition at 9:16. Not pixel-identical to
// the FFmpeg output (see README drift), but close enough to guide editing.
const PREVIEW_W = 300;
const PREVIEW_H = Math.round((PREVIEW_W * 16) / 9); // 533
const SF = PREVIEW_W / 1080; // scale factor from the 1080-wide frame

export function Preview({
  composition, coverSrc, selectedId, onSelect,
}: {
  composition: Composition;
  coverSrc: string | null;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const bg = getLayer<BackgroundLayer>(composition, 'background');
  const cover = getLayer<CoverLayer>(composition, 'cover_art');
  const title = getLayer<TitleLayer>(composition, 'title_text');
  const wave = getLayer<WaveformLayer>(composition, 'waveform');
  const effect = getLayer<EffectLayer>(composition, 'effect_overlay');

  const sel = (id: string) => (e: MouseEvent) => { e.stopPropagation(); onSelect(id); };
  const ring = (id: string) => (selectedId === id ? '0 0 0 2px #4f8cff' : 'none');

  return (
    <div className="preview" style={{ width: PREVIEW_W, height: PREVIEW_H }} onClick={() => onSelect('background')}>
      {/* background */}
      {bg?.visible && (
        <div
          onClick={sel('background')}
          style={{
            position: 'absolute', inset: 0, cursor: 'pointer', boxShadow: ring('background'),
            backgroundColor: '#0b0d11',
            backgroundImage: coverSrc ? `url("${coverSrc}")` : undefined,
            backgroundSize: 'cover', backgroundPosition: 'center',
            filter: `blur(${Math.min(bg.blur * 0.6, 24)}px) brightness(${1 + bg.brightness}) saturate(${bg.saturation})`,
            transform: `scale(${1.1 + (bg.zoom ?? 0) * 0.5})`,
            opacity: bg.opacity,
          }}
        />
      )}

      {/* effect: vignette */}
      {effect?.visible && effect.vignette && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 120px 40px rgba(0,0,0,0.75)' }} />
      )}

      {/* cover art */}
      {cover?.visible && (
        <div
          onClick={sel('cover_art')}
          style={{
            position: 'absolute', left: `${cover.x * 100}%`, top: `${cover.y * 100}%`,
            width: `${cover.scale * 100}%`, aspectRatio: '1 / 1',
            transform: `translate(-50%, -50%) rotate(${cover.rotation}deg)`,
            borderRadius: cover.shape === 'circle' ? '50%' : cover.shape === 'rounded' ? '12%' : '2%',
            overflow: 'hidden', cursor: 'pointer', boxShadow: ring('cover_art'),
            opacity: cover.opacity,
            filter: cover.shadow > 0 ? `drop-shadow(0 ${cover.shadow * 18}px ${cover.shadow * 30}px rgba(0,0,0,${0.3 + cover.shadow * 0.4}))` : undefined,
          }}
        >
          {coverSrc
            ? <img src={coverSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', background: '#2a2f3a', display: 'grid', placeItems: 'center', fontSize: 11, color: '#9aa3b2' }}>cover</div>}
        </div>
      )}

      {/* waveform placeholder */}
      {wave?.visible && (
        <div onClick={sel('waveform')}
          style={{ position: 'absolute', left: 0, right: 0, bottom: PREVIEW_H * 0.18, height: 36, display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 2, cursor: 'pointer', boxShadow: ring('waveform') }}>
          {Array.from({ length: 48 }).map((_, i) => (
            <span key={i} style={{ width: 2, height: `${10 + Math.abs(Math.sin(i * 0.7)) * 26}px`, background: cssColor(wave.color), opacity: 0.85 }} />
          ))}
        </div>
      )}

      {/* title */}
      {title?.visible && title.text && (
        <div onClick={sel('title_text')}
          style={{
            position: 'absolute', left: 0, right: 0, top: `${title.y * 100}%`, transform: 'translateY(-50%)',
            textAlign: title.align, padding: '0 16px', cursor: 'pointer', boxShadow: ring('title_text'),
          }}>
          <span style={{
            fontSize: Math.max(10, title.size * SF), fontWeight: 700, color: title.color,
            background: title.box ? `rgba(0,0,0,${title.boxOpacity})` : 'transparent',
            padding: title.box ? '2px 10px' : 0, borderRadius: 4, opacity: title.opacity,
            lineHeight: 1.2, display: 'inline-block',
          }}>
            {title.text}
          </span>
        </div>
      )}
    </div>
  );
}

// FFmpeg colors are like "white" or "0x4fd1ff"; map to CSS for the preview.
function cssColor(c: string): string {
  if (/^0x[0-9a-f]{6}$/i.test(c)) return '#' + c.slice(2);
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  return c || 'white';
}
