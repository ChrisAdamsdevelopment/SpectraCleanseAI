// v0 render spike — turn one song's assets into one vertical promotional video.
//
// REAL: produces an actual MP4 with FFmpeg (cover art + blurred background +
//       audio waveform + optional title), exported locally.
// PLANNED: animated lyric videos / richer compositions via Remotion (React);
//          a desktop UI (Tauri). This file is a CLI proof of the pipeline only.
//
// Usage:
//   node render.mjs --format tiktok --image cover.png --audio song.mp3 --title "Song Name" --out out/song.mp4
//   node render.mjs --format canvas --image cover.png --out out/canvas.mp4   (canvas is silent)

import { execFile } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { promisify } from 'node:util';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { PRESETS } from './presets.mjs';

const run = promisify(execFile);

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = (argv[i] || '').replace(/^--/, '');
    if (key) a[key] = argv[i + 1];
  }
  return a;
}

// FFmpeg drawtext needs a real font file; fall back across common OS locations.
function resolveFont(explicit) {
  const candidates = [
    explicit,
    'C:/Windows/Fonts/arialbd.ttf', 'C:/Windows/Fonts/arial.ttf', 'C:/Windows/Fonts/segoeui.ttf',
    '/System/Library/Fonts/Supplemental/Arial.ttf', '/Library/Fonts/Arial.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
  ].filter(Boolean);
  return candidates.find((p) => { try { return existsSync(p); } catch { return false; } }) || null;
}

const ffEscapePath = (p) => p.replace(/\\/g, '/').replace(/:/g, '\\:');
const sanitizeText = (t) => String(t || '').replace(/[:%'\\\n\r]/g, ' ').slice(0, 60).trim();

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const preset = PRESETS[args.format];
  if (!preset) {
    console.error(`Unknown --format "${args.format || ''}". Options: ${Object.keys(PRESETS).join(', ')}`);
    process.exit(1);
  }
  if (!args.image || !existsSync(args.image)) {
    console.error('Missing or nonexistent --image (cover art).');
    process.exit(1);
  }
  if (preset.audio && (!args.audio || !existsSync(args.audio))) {
    console.error(`Format "${args.format}" needs --audio (a song file).`);
    process.exit(1);
  }

  const { width: W, height: H, fps, maxDurationSec } = preset;
  const dur = Math.max(1, Math.min(Number(args.duration) || maxDurationSec, 60));
  const frames = Math.round(dur * fps);
  const out = args.out || `out/${args.format}.mp4`;
  mkdirSync(path.dirname(out), { recursive: true });

  const title = sanitizeText(args.title);
  const font = resolveFont(args.font);
  const fgW = Math.round(W * 0.8);

  const inputs = ['-loop', '1', '-i', args.image];
  if (preset.audio) inputs.push('-i', args.audio);

  let fc = '';
  if (preset.audio) {
    fc += `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2,eq=brightness=-0.12[bg];`;
    fc += `[0:v]scale=${fgW}:-2[fg];`;
    fc += `[bg][fg]overlay=(W-w)/2:(H-h)/2-140[base];`;
    fc += `[1:a]showwaves=s=${W}x260:mode=cline:rate=${fps}:colors=white,format=yuva420p[wave];`;
    fc += `[base][wave]overlay=0:H-360[comp]`;
  } else {
    const zW = Math.round(W * 1.25), zH = Math.round(H * 1.25);
    fc += `[0:v]scale=${zW}:${zH}:force_original_aspect_ratio=increase,crop=${zW}:${zH},zoompan=z='min(zoom+0.0004,1.2)':d=${frames}:s=${W}x${H}:fps=${fps},boxblur=8:1[bg];`;
    fc += `[0:v]scale=${fgW}:-2[fg];`;
    fc += `[bg][fg]overlay=(W-w)/2:(H-h)/2[comp]`;
  }

  let vlabel = 'comp';
  if (title && font) {
    fc += `;[comp]drawtext=fontfile='${ffEscapePath(font)}':text='${title}':fontcolor=white:fontsize=64:x=(w-text_w)/2:y=h-230:box=1:boxcolor=black@0.4:boxborderw=26[vout]`;
    vlabel = 'vout';
  } else if (title && !font) {
    console.warn('[render] no system font found; skipping the title overlay (Remotion will own rich text later).');
  }

  const ffArgs = [
    ...inputs,
    '-filter_complex', fc,
    '-map', `[${vlabel}]`,
    ...(preset.audio ? ['-map', '1:a', '-c:a', 'aac', '-b:a', '192k', '-shortest'] : ['-an']),
    '-t', String(dur), '-r', String(fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-y', out,
  ];

  console.log(`[render] ${preset.label} · ${W}x${H} · ${dur}s${title ? ` · title="${title}"` : ''}`);
  const t0 = Date.now();
  try {
    await run(ffmpegPath, ffArgs, { maxBuffer: 1024 * 1024 * 128 });
  } catch (err) {
    const tail = String(err.stderr || err.message || '').split('\n').slice(-18).join('\n');
    console.error('[render] FFmpeg failed:\n' + tail);
    process.exit(1);
  }
  const kb = (statSync(out).size / 1024).toFixed(0);
  console.log(`[render] done in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out} (${kb} KB)`);
}

main();
