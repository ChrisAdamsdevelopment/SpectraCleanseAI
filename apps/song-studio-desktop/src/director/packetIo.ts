// Packet + result IO (DEC-003 §7, §10). Materializes a manual generation
// package to disk (text files, copied references, extracted scene-audio wav),
// and reads a returned MP4 back with a sidecar return-manifest so binding is
// never filename guessing. Framework-agnostic: the ffmpeg binary and fs ops are
// injected so the same code serves the Node harness and the Tauri host.

import type { GenerationPacket, PacketFileDirective } from './compile';

export interface PacketFs {
  mkdir(dir: string): Promise<void>;
  writeText(path: string, content: string): Promise<void>;
  copyFile(from: string, to: string): Promise<void>;
  join(...parts: string[]): string;
  /** Extract [startSec, startSec+durationSec] of an audio file to a wav. */
  extractAudio(src: string, toWav: string, startSec: number, durationSec: number): Promise<void>;
  readText(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  statBytes(path: string): Promise<number>;
}

/** Write the complete manual generation package under `destDir`. Returns the
 * list of relative paths written (for the manifest / UI). */
export async function writePacket(packet: GenerationPacket, destDir: string, fs: PacketFs): Promise<string[]> {
  const written: string[] = [];
  const dirs = new Set<string>();
  for (const f of packet.files) {
    const slash = f.relPath.lastIndexOf('/');
    if (slash > 0) dirs.add(f.relPath.slice(0, slash));
  }
  await fs.mkdir(destDir);
  for (const d of dirs) await fs.mkdir(fs.join(destDir, d));

  for (const f of packet.files) {
    const abs = fs.join(destDir, f.relPath);
    await materialize(f, abs, fs);
    written.push(f.relPath);
  }
  return written;
}

async function materialize(f: PacketFileDirective, abs: string, fs: PacketFs): Promise<void> {
  if (f.kind === 'text') return fs.writeText(abs, f.content);
  if (f.kind === 'copy') { if (await fs.exists(f.sourcePath)) return fs.copyFile(f.sourcePath, abs); return; }
  if (f.kind === 'audio-segment') { if (await fs.exists(f.audioPath)) return fs.extractAudio(f.audioPath, abs, f.startSec, f.durationSec); return; }
}

export interface ReturnManifest { attemptId: string }

/** Resolve which take a returned MP4 binds to. Priority: an explicit
 * return-manifest.json sidecar next to the MP4 (authoritative), else the
 * caller-supplied guided selection. Never pure filename guessing. */
export async function resolveReturnAttemptId(mp4Path: string, fs: PacketFs, guidedAttemptId?: string): Promise<{ attemptId: string | null; via: 'manifest' | 'guided' | 'none' }> {
  const dir = mp4Path.slice(0, Math.max(0, mp4Path.lastIndexOf('/')));
  const sidecar = fs.join(dir, 'return-manifest.json');
  if (await fs.exists(sidecar)) {
    try {
      const parsed = JSON.parse(await fs.readText(sidecar)) as Partial<ReturnManifest>;
      if (typeof parsed.attemptId === 'string' && parsed.attemptId) return { attemptId: parsed.attemptId, via: 'manifest' };
    } catch { /* fall through */ }
  }
  if (guidedAttemptId) return { attemptId: guidedAttemptId, via: 'guided' };
  return { attemptId: null, via: 'none' };
}

export interface MediaMeta { bytes: number }

export async function importedVideoMeta(mp4Path: string, fs: PacketFs): Promise<MediaMeta> {
  return { bytes: (await fs.exists(mp4Path)) ? await fs.statBytes(mp4Path) : 0 };
}
