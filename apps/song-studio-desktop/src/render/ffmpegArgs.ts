import type { RenderJob, RenderRecipe, VisualTemplate } from './types';

// Pure: builds the FFmpeg argument list (everything after the ffmpeg binary)
// from a job + recipe + visual template. The caller prepends its own ffmpeg
// binary path, so this stays runtime-agnostic. Deterministic — no AI, no shaders.

export function sanitizeTitle(t?: string): string {
  return String(t || '').replace(/[:%'\\\n\r]/g, ' ').slice(0, 60).trim();
}

function ffEscapePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export interface BuildArgsOptions {
  fontPath?: string | null;
}

export function buildFfmpegArgs(
  job: RenderJob,
  recipe: RenderRecipe,
  template: VisualTemplate,
  opts: BuildArgsOptions = {},
): string[] {
  const W = recipe.width;
  const H = recipe.height;
  const fps = recipe.fps;
  const dur = clamp(job.durationSec ?? recipe.defaultDurationSec, 1, 60);
  const frames = Math.round(dur * fps);
  const fgW = Math.round(W * template.coverScale);
  const useAudio = recipe.audioRequired && Boolean(job.audioPath);
  const useWave = useAudio && recipe.overlayStyle === 'waveform';
  const start = Math.max(0, job.audioStartSec ?? 0);

  const inputs: string[] = ['-loop', '1', '-i', job.imagePath];
  if (useAudio) {
    if (start > 0) inputs.push('-ss', String(start)); // seek the song to the clip start
    inputs.push('-i', job.audioPath as string);
  }

  const eq = `eq=brightness=${template.bgBrightness}:saturation=${template.bgSaturation}`;
  const vignette = template.vignette ? ',vignette=PI/5' : '';

  const chains: string[] = [];
  if (recipe.motionStyle === 'zoom' && !useAudio) {
    const zW = Math.round(W * 1.25);
    const zH = Math.round(H * 1.25);
    chains.push(
      `[0:v]scale=${zW}:${zH}:force_original_aspect_ratio=increase,crop=${zW}:${zH},` +
      `zoompan=z='min(zoom+0.0004,1.2)':d=${frames}:s=${W}x${H}:fps=${fps},boxblur=${template.bgBlur}:1,${eq}${vignette}[bg]`,
    );
  } else {
    chains.push(
      `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},` +
      `boxblur=${template.bgBlur}:2,${eq}${vignette}[bg]`,
    );
  }
  chains.push(`[0:v]scale=${fgW}:-2[fg]`);
  const overlayY = useWave ? '(H-h)/2-140' : '(H-h)/2';
  chains.push(`[bg][fg]overlay=(W-w)/2:${overlayY}[base]`);

  let last = 'base';
  if (useWave) {
    chains.push(`[1:a]showwaves=s=${W}x260:mode=cline:rate=${fps}:colors=${template.waveColor},format=yuva420p[wave]`);
    chains.push(`[base][wave]overlay=0:H-360[comp]`);
    last = 'comp';
  }

  let vlabel = last;
  const title = sanitizeTitle(job.title);
  if (title && opts.fontPath) {
    chains.push(
      `[${last}]drawtext=fontfile='${ffEscapePath(opts.fontPath)}':text='${title}':fontcolor=white:` +
      `fontsize=${template.titleFontSize}:x=(w-text_w)/2:y=h-230:box=1:boxcolor=black@${template.titleBoxAlpha}:boxborderw=26[vout]`,
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
    '-y', job.outputPath,
  ];
}
