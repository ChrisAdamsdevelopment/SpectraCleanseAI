import type { Composition, BackgroundLayer, CoverLayer, TitleLayer, WaveformLayer, EffectLayer } from './types';
import { getLayer } from './composition';

// Pure: builds the FFmpeg argument list from a Composition + render inputs.
// The caller prepends its own ffmpeg binary. Deterministic — no AI, no shaders.
// FFmpeg respects: background blur/brightness/saturation/zoom, cover scale +
// position (square), title text/size/position/color/box/opacity/align, vignette,
// waveform color. See README "preview/export drift" for what is preview-only.

export function sanitizeTitle(t?: string): string {
  return String(t || '').replace(/[:%'\\\n\r]/g, ' ').slice(0, 60).trim();
}
function ffEscapePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}
function ffColor(c: string): string {
  const s = (c || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return '0x' + s.slice(1);
  return s || 'white';
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface RenderInputs {
  imagePath: string;
  audioPath?: string | null;
  outputPath: string;
  durationSec: number;
  audioStartSec?: number;
}
export interface BuildArgsOptions {
  fontPath?: string | null;
}

export function buildFfmpegArgs(comp: Composition, rt: RenderInputs, opts: BuildArgsOptions = {}): string[] {
  const W = comp.width;
  const H = comp.height;
  const fps = comp.fps;
  const dur = clamp(rt.durationSec, 1, 60);
  const frames = Math.round(dur * fps);

  const bg = getLayer<BackgroundLayer>(comp, 'background');
  const cover = getLayer<CoverLayer>(comp, 'cover_art');
  const title = getLayer<TitleLayer>(comp, 'title_text');
  const wave = getLayer<WaveformLayer>(comp, 'waveform');
  const effect = getLayer<EffectLayer>(comp, 'effect_overlay');

  const useAudio = comp.audio && Boolean(rt.audioPath);
  const useWave = useAudio && Boolean(wave?.visible);
  const start = Math.max(0, rt.audioStartSec ?? 0);

  const inputs: string[] = ['-loop', '1', '-i', rt.imagePath];
  if (useAudio) {
    if (start > 0) inputs.push('-ss', String(start));
    inputs.push('-i', rt.audioPath as string);
  }

  const blur = bg?.blur ?? 18;
  const brightness = bg?.brightness ?? -0.12;
  const saturation = bg?.saturation ?? 1;
  const eq = `eq=brightness=${brightness}:saturation=${saturation}`;
  const vignette = effect?.visible && effect.vignette ? ',vignette=PI/5' : '';

  const chains: string[] = [];
  if ((bg?.zoom ?? 0) > 0 && !useAudio) {
    const zW = Math.round(W * 1.25);
    const zH = Math.round(H * 1.25);
    chains.push(
      `[0:v]scale=${zW}:${zH}:force_original_aspect_ratio=increase,crop=${zW}:${zH},` +
      `zoompan=z='min(zoom+0.0004,${1 + (bg?.zoom ?? 0)})':d=${frames}:s=${W}x${H}:fps=${fps},boxblur=${blur}:1,${eq}${vignette}[bg]`,
    );
  } else {
    chains.push(
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=${blur}:2,${eq}${vignette}[bg]`,
    );
  }

  const coverScale = cover?.scale ?? 0.8;
  const coverVisible = cover?.visible ?? true;
  let last = 'bg';
  if (coverVisible) {
    const fgW = Math.round(W * coverScale);
    const cx = Math.round((cover?.x ?? 0.5) * W);
    const cy = Math.round((cover?.y ?? 0.5) * H);
    chains.push(`[0:v]scale=${fgW}:-2[fg]`);
    chains.push(`[bg][fg]overlay=${cx}-w/2:${cy}-h/2[base]`);
    last = 'base';
  }

  if (useWave) {
    chains.push(`[1:a]showwaves=s=${W}x260:mode=cline:rate=${fps}:colors=${ffColor(wave!.color)},format=yuva420p[wave]`);
    chains.push(`[${last}][wave]overlay=0:H-360[comp]`);
    last = 'comp';
  }

  let vlabel = last;
  const titleText = sanitizeTitle(title?.text);
  if (title?.visible && titleText && opts.fontPath) {
    const tx = title.align === 'left' ? '64'
      : title.align === 'right' ? `w-text_w-64`
      : '(w-text_w)/2';
    const ty = Math.round(title.y * H);
    const box = title.box ? `:box=1:boxcolor=black@${title.boxOpacity}:boxborderw=26` : '';
    chains.push(
      `[${last}]drawtext=fontfile='${ffEscapePath(opts.fontPath)}':text='${titleText}':` +
      `fontcolor=${ffColor(title.color)}:fontsize=${Math.round(title.size)}:x=${tx}:y=${ty}${box}[vout]`,
    );
    vlabel = 'vout';
  }

  return [
    ...inputs,
    '-filter_complex', chains.join(';'),
    '-map', `[${vlabel}]`,
    ...(useAudio ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : ['-an']),
    '-t', String(dur),
    '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-y', rt.outputPath,
  ];
}
