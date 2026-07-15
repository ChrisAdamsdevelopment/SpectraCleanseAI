// Host bridge for Director Mode UI. The workspace stays framework-thin: all
// pure logic is in director/*, all real IO goes through this interface, which
// App implements with Tauri (file pickers, fs plugin, run_ffmpeg, fetch). A
// browser/no-op fallback keeps `npm run dev` and typecheck honest.

import type { GenerationPacket } from './compile';
import type { PacketFileDirective } from './compile';
import type { ProviderCapabilities, ImageProviderCapabilities, ProviderIo } from './providers/types';
import { PROVIDERS, DEFAULT_PROVIDER_ID, capabilitiesFor, IMAGE_PROVIDERS, DEFAULT_IMAGE_PROVIDER_ID, imageCapabilitiesFor } from './providers/registry';

export interface SubmitOutcome {
  ok: boolean;
  jobId?: string;
  error?: string;
  blockedReason?: string; // e.g. "no API key configured" — surfaced, not hidden
}

export interface ProviderChoice { id: string; label: string; role: string; bestFor: string }

export interface DirectorHost {
  /** True when this host can write packet files to disk (Tauri). The UI must
   * disable export actions when false — never rely on downstream throws. */
  canExportPackets: boolean;
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
  // provider selection (capabilities contract, not provider names in logic)
  providers(): ProviderChoice[];
  selectedProviderId(): string;
  setProvider(id: string): void;
  providerCapabilities(): ProviderCapabilities;
  setApiKey(key: string | null): void;
  // live provider (may be credential-blocked — never silently succeeds)
  providerConfigured(): boolean;
  submitGeneration(packet: GenerationPacket, opts?: { sourceVideoPath?: string; parentInteractionId?: string }): Promise<SubmitOutcome>;
  /** Poll and, on success, materialize the MP4 locally; returns resultPath. */
  pollGeneration(jobId: string): Promise<{ phase: string; error?: string; resultPath?: string }>;
  // image provider (reference-variant generation, §1)
  imageProviders(): ProviderChoice[];
  selectedImageProviderId(): string;
  setImageProvider(id: string): void;
  imageProviderCapabilities(): ImageProviderCapabilities;
  /** Submit a reference-variant image request; conditioningPaths are approved
   * reference image paths used as identity guides. */
  submitReferenceGeneration(prompt: string, conditioningPaths: string[], outputCount: number, aspect: string): Promise<SubmitOutcome>;
  /** Poll a reference image job; on success returns materialized local paths. */
  pollReferenceGeneration(jobId: string): Promise<{ phase: string; error?: string; resultPaths?: string[] }>;
  // assembly: run the workprint ffmpeg args, returns bytes written (0 = failed)
  runFfmpeg(args: string[]): Promise<number>;
  /** The host's provider IO, exposed so Settings can run connection tests
   * through the same injected boundary the adapters use (ALPHA-001 §6). Null in
   * the browser fallback, where live calls are unavailable anyway. */
  providerIo?: ProviderIo | null;
}

/** Non-Tauri fallback: pickers/writes are unavailable; the UI disables those
 * actions and explains why. Nothing pretends to work. */
export const browserHost: DirectorHost = {
  canExportPackets: false,
  async pickReferenceImage() { return null; },
  async pickGeneratedVideo() { return null; },
  async pickPacketDir() { return null; },
  toSrc() { return null; },
  async writePacket() { throw new Error('File export needs the desktop app (npm run tauri dev).'); },
  async writeFiles() { throw new Error('File export needs the desktop app.'); },
  async resolveReturnAttempt() { return { attemptId: null, via: 'none' }; },
  async fileBytes() { return 0; },
  providers() { return PROVIDERS.map((p) => ({ id: p.id, label: p.label, role: p.role, bestFor: p.bestFor })); },
  selectedProviderId() { return DEFAULT_PROVIDER_ID; },
  setProvider() { /* no-op in browser */ },
  providerCapabilities() { return capabilitiesFor(DEFAULT_PROVIDER_ID); },
  setApiKey() { /* no-op in browser */ },
  providerConfigured() { return false; },
  async submitGeneration() { return { ok: false, blockedReason: 'Live generation needs the desktop app and an API key.' }; },
  async pollGeneration() { return { phase: 'failed', error: 'unavailable' }; },
  imageProviders() { return IMAGE_PROVIDERS.map((p) => ({ id: p.id, label: p.label, role: p.role, bestFor: p.bestFor })); },
  selectedImageProviderId() { return DEFAULT_IMAGE_PROVIDER_ID; },
  setImageProvider() { /* no-op in browser */ },
  imageProviderCapabilities() { return imageCapabilitiesFor(DEFAULT_IMAGE_PROVIDER_ID); },
  async submitReferenceGeneration() { return { ok: false, blockedReason: 'Live reference generation needs the desktop app and an API key.' }; },
  async pollReferenceGeneration() { return { phase: 'failed', error: 'unavailable' }; },
  async runFfmpeg() { return 0; },
  providerIo: null,
};
