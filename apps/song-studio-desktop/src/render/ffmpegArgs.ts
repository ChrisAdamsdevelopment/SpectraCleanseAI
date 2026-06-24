import type { RenderJob, RenderPreset } from './types';

// Pure: builds the FFmpeg argument list (everything after the ffmpeg binary).
// Ported from the PR #53 render spike. The caller prepends its own ffmpeg
// binary path (Node uses ffmpeg-static; the Tauri command uses a system/sidecar
// ffmpeg), so this stays runtime-agnostic.

export function sanitizeTitle(t?: string): string {
  return String(t || '').replace(/[:%'\\\n\r]/g, ' ').slice(0, 60).trim();
}

function ffEscapePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

export interface BuildArgsOptions {
  /** Absolute path to a .ttf used for the title overlay; omit to skip the title. */
  fontPath?: string | null;
}

export function buildFfmpegArgs(job: RenderJob, preset: RenderPreset, opts: BuildArgsOptions = {}): string[] {
  const W = preset.width;
  const H = preset.height;
  const fps = preset.fps;
  const dur = Math.max(1, Math.min(job.durationSec || preset.maxDurationSec, 60));
  const frames = Math.round(dur * fps);
  const fgW = Math.round(W * 0.8);
  const useAudio = preset.audio && Boolean(job.audioPath);

  const inputs: string[] = ['-loop', '1', '-i', job.imagePath];
  if (useAudio) inputs.push('-i', job.audioPath as string);

  let fc = '';
  if (useAudio) {
    fc += `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2,eq=brightness=-0.12[bg];`;
    fc += `[0:v]scale=${fgW}:-2[fg];`;
    fc += `[bg][fg]overlay=(W-w)/2:(H-h)/2-140[base];`;
    fc += `[1:a]showwaves=s=${W}x260:mode=cline:rate=${fps}:colors=white,format=yuva420p[wave];`;
    fc += `[base][wave]overlay=0:H-360[comp]`;
  } else {
    const zW = Math.round(W * 1.25);
    const zH = Math.round(H * 1.25);
    fc += `[0:v]scale=${zW}:${zH}:force_original_aspect_ratio=increase,crop=${zW}:${zH},zoompan=z='min(zoom+0.0004,1.2)':d=${frames}:s=${W}x${H}:fps=${fps},boxblur=8:1[bg];`;
    fc += `[0:v]scale=${fgW}:-2[fg];`;
    fc += `[bg][fg]overlay=(W-w)/2:(H-h)/2[comp]`;
  }

  let vlabel = 'comp';
  const title = sanitizeTitle(job.title);
  if (title && opts.fontPath) {
    fc += `;[comp]drawtext=fontfile='${ffEscapePath(opts.fontPath)}':text='${title}':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=h-230:box=1:boxcolor=black@0.4:boxborderw=26[vout]`;
    vlabel = 'vout';
  }

  return [
    ...inputs,
    '-filter_complex', fc,
    '-map', `[${vlabel}]`,
    ...(useAudio ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : ['-an']),
    '-t', String(dur),
    '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-y', job.outputPath,
  ];
}
