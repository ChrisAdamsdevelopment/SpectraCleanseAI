// Host bridge for Director Mode UI. The workspace stays framework-thin: all
// pure logic is in director/*, all real IO goes through this interface, which
// App implements with Tauri (file pickers, fs plugin, run_ffmpeg, fetch). A
// browser/no-op fallback keeps `npm run dev` and typecheck honest.

import type { GenerationPacket } from './compile';
import type { PacketFileDirective } from './compile';

export interface SubmitOutcome {
  ok: boolean;
  jobId?: string;
  error?: string;
  blockedReason?: string; // e.g. "no API key configured" — surfaced, not hidden
}

export interface DirectorHost {
  // pickers
  pickReferenceImage(): Promise<string | null>;
  pickGeneratedVideo(): Promise<string | null>;
  pickPacketDir(): Promise<string | null>;
  // preview src for <img>/<video>
  toSrc(path: string): string | null;
  // manual bridge
  writePacket(packet: GenerationPacket, destDir: string): Promise<string[]>;
  writeFiles(files: PacketFileDirective[], destDir: string): Promise<string[]>;
  resolveReturnAttempt(mp4Path: string, guidedAttemptId?: string): Promise<{ attemptId: string | null; via: 'manifest' | 'guided' | 'none' }>;
  fileBytes(path: string): Promise<number>;
  // live provider (may be credential-blocked — never silently succeeds)
  providerConfigured(): boolean;
  submitGeneration(packet: GenerationPacket): Promise<SubmitOutcome>;
  pollGeneration(jobId: string): Promise<{ phase: string; error?: string; resultPath?: string }>;
  // assembly: run the workprint ffmpeg args, returns bytes written (0 = failed)
  runFfmpeg(args: string[]): Promise<number>;
}

/** Non-Tauri fallback: pickers/writes are unavailable; the UI disables those
 * actions and explains why. Nothing pretends to work. */
export const browserHost: DirectorHost = {
  async pickReferenceImage() { return null; },
  async pickGeneratedVideo() { return null; },
  async pickPacketDir() { return null; },
  toSrc() { return null; },
  async writePacket() { throw new Error('File export needs the desktop app (npm run tauri dev).'); },
  async writeFiles() { throw new Error('File export needs the desktop app.'); },
  async resolveReturnAttempt() { return { attemptId: null, via: 'none' }; },
  async fileBytes() { return 0; },
  providerConfigured() { return false; },
  async submitGeneration() { return { ok: false, blockedReason: 'Live generation needs the desktop app and an API key.' }; },
  async pollGeneration() { return { phase: 'failed', error: 'unavailable' }; },
  async runFfmpeg() { return 0; },
};
