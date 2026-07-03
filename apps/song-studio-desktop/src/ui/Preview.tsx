import { useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import type { Composition, BackgroundLayer, CoverLayer, TitleLayer, WaveformLayer, EffectLayer } from '../render/types';
import { getLayer } from '../render/composition';
import { getFontFamily } from '../lib/fonts';

const PREVIEW_W = 360;
const PREVIEW_H = Math.round((PREVIEW_W * 16) / 9);
const SF = PREVIEW_W / 1080;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

// Live DOM/CSS approximation of the composition at 9:16 (see README drift).
export function Preview({
  composition, coverSrc, selectedId, onSelect, onMove,
}: {
  composition: Composition;
  coverSrc: string | null;
  selectedId: string;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string } | null>(null);
  const [imgError, setImgError] = useState(false);

  const bg = getLayer<BackgroundLayer>(composition, 'background');
  const cover = getLayer<CoverLayer>(composition, 'cover_art');
  const title = getLayer<TitleLayer>(composition, 'title_text');
  const wave = getLayer<WaveformLayer>(composition, 'waveform');
  const effect = getLayer<EffectLayer>(composition, 'effect_overlay');
  const showMedia = Boolean(coverSrc) && !imgError;

  function startDrag(id: string) {
    return (e: RPointerEvent) => {
      e.stopPropagation();
      onSelect(id);
      drag.current = { id };
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    };
  }
  function onPointerMove(e: RPointerEvent) {
    if (!drag.current || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    onMove(drag.current.id, clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
  }
  const endDrag = () => { drag.current = null; };
  const ring = (id: string) => (selectedId === id ? '0 0 0 2px #4f8cff' : 'none');

  return (
    <div>
      <div
        ref={ref} className="preview" style={{ width: PREVIEW_W, height: PREVIEW_H }}
        onClick={() => onSelect('background')} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerLeave={endDrag}
      >
        {/* background (cover art, blurred) */}
        {bg?.visible && showMedia && (
          <img
            src={coverSrc as string} alt="" onError={() => setImgError(true)} draggable={false}
            onClick={(e) => { e.stopPropagation(); onSelect('background'); }}
            className={(bg.zoom ?? 0) > 0 ? 'bg-motion' : undefined}
            style={{
              position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', cursor: 'pointer', boxShadow: ring('background'),
              filter: `blur(${Math.min((bg.blur ?? 0) * 0.6, 24)}px) brightness(${1 + bg.brightness}) saturate(${bg.saturation}) contrast(${bg.contrast ?? 1})`,
              // No inline transform when animating: the .bg-motion keyframes own it (hints the exported Ken Burns zoom).
              transform: (bg.zoom ?? 0) > 0 ? undefined : `scale(${1.1 + (bg.zoom ?? 0) * 0.5})`, opacity: bg.opacity,
            }}
          />
        )}

        {/* effect: vignette */}
        {effect?.visible && effect.vignette && showMedia && (
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', boxShadow: 'inset 0 0 120px 40px rgba(0,0,0,0.75)' }} />
        )}

        {/* cover art */}
        {cover?.visible && showMedia && (
          <img
            src={coverSrc as string} alt="cover" draggable={false} onError={() => setImgError(true)}
            onPointerDown={startDrag('cover_art')}
            style={{
              position: 'absolute', left: `${cover.x * 100}%`, top: `${cover.y * 100}%`,
              width: `${cover.scale * 100}%`, aspectRatio: '1 / 1', objectFit: 'cover',
              transform: `translate(-50%, -50%) rotate(${cover.rotation}deg)`,
              borderRadius: cover.shape === 'circle' ? '50%' : cover.shape === 'rounded' ? '12%' : '2%',
              cursor: 'grab', boxShadow: ring('cover_art'), opacity: cover.opacity,
              filter: cover.shadow > 0 ? `drop-shadow(0 ${cover.shadow * 18}px ${cover.shadow * 30}px rgba(0,0,0,${0.3 + cover.shadow * 0.4}))` : undefined,
            }}
          />
        )}

        {/* waveform placeholder */}
        {wave?.visible && (
          <div onClick={(e) => { e.stopPropagation(); onSelect('waveform'); }}
            style={{ position: 'absolute', left: 0, right: 0, top: `${wave.y * 100}%`, transform: 'translateY(-50%)', height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, cursor: 'pointer', boxShadow: ring('waveform'), opacity: wave.opacity }}>
            {Array.from({ length: 48 }).map((_, i) => (
              <span key={i} style={{ width: 2, height: `${10 + Math.abs(Math.sin(i * 0.7)) * 26}px`, background: cssColor(wave.color) }} />
            ))}
          </div>
        )}

        {/* title */}
        {title?.visible && title.text && (
          <div onPointerDown={startDrag('title_text')}
            style={{
              position: 'absolute', left: `${title.x * 100}%`, top: `${title.y * 100}%`,
              transform: titleTransform(title.align), cursor: 'grab', boxShadow: ring('title_text'), maxWidth: '92%',
            }}>
            <span style={{
              fontFamily: getFontFamily(title.font).css, fontSize: Math.max(10, title.size * SF), fontWeight: 700, color: title.color,
              background: title.box ? `rgba(0,0,0,${title.boxOpacity})` : 'transparent', padding: title.box ? '2px 10px' : 0,
              borderRadius: 4, opacity: title.opacity, lineHeight: 1.2, display: 'inline-block', whiteSpace: 'nowrap',
              // Match the exported drawtext outline + soft shadow (clean text, no slab).
              WebkitTextStroke: (title.stroke ?? 0) > 0 ? `${Math.max(0.5, (title.stroke ?? 0) * SF)}px ${cssColor(title.strokeColor ?? '#000000')}` : undefined,
              textShadow: (title.shadow ?? 0) > 0 ? `0 ${Math.max(1, (title.shadow ?? 0) * SF)}px ${Math.max(1, (title.shadow ?? 0) * 1.5 * SF)}px rgba(0,0,0,0.55)` : undefined,
            }}>{title.text}</span>
          </div>
        )}

        {/* empty / error states */}
        {!coverSrc && (
          <div className="preview-empty">Choose cover art to preview this layout.</div>
        )}
        {coverSrc && imgError && (
          <div className="preview-empty err">Cover art selected but could not be loaded in preview.</div>
        )}
      </div>
    </div>
  );
}

function titleTransform(align: TitleLayer['align']): string {
  if (align === 'left') return 'translate(0, -50%)';
  if (align === 'right') return 'translate(-100%, -50%)';
  return 'translate(-50%, -50%)';
}
function cssColor(c: string): string {
  if (/^0x[0-9a-f]{6}$/i.test(c)) return '#' + c.slice(2);
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  return c || '#ffffff';
}
