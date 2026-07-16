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
  // provider selection (capabilities contract, not provider names in logic).
  // The selected id MAY be the literal 'auto' — resolvedVideoProviderId()
  // resolves it against capabilities + connected accounts.
  providers(): ProviderChoice[];
  selectedProviderId(): string;
  setProvider(id: string): void;
  /** Resolve 'auto' (or a concrete id) to the concrete provider that will
   * actually run. Used to record the provider on the take (so polling is
   * take-scoped) and to show the creator which provider Auto chose. */
  resolvedVideoProviderId(): string;
  providerCapabilities(): ProviderCapabilities;
  // live provider (may be credential-blocked — never silently succeeds).
  // providerConfigured reflects whether the RESOLVED video provider's account
  // has a usable key right now (secure store OR session) — no restart needed.
  providerConfigured(): boolean;
  /** Submit on an EXPLICIT provider when given (repairs pass the child take's
   * recorded provider), else the resolved video provider. Keeps submit and the
   * recorded take provider identical, so polling is always take-scoped. */
  submitGeneration(packet: GenerationPacket, opts?: { sourceVideoPath?: string; parentInteractionId?: string; providerId?: string }): Promise<SubmitOutcome>;
  /** Poll a job on the take's RECORDED provider (never the current UI
   * selection) and, on success, materialize the MP4 locally. */
  pollGeneration(jobId: string, providerId: string): Promise<{ phase: string; error?: string; resultPath?: string }>;
  // image provider (reference-variant generation, §1)
  imageProviders(): ProviderChoice[];
  selectedImageProviderId(): string;
  setImageProvider(id: string): void;
  resolvedImageProviderId(): string;
  imageProviderCapabilities(): ImageProviderCapabilities;
  /** Submit a reference-variant image request; conditioningPaths are approved
   * reference image paths used as identity guides. Returns the concrete
   * providerId used, so it can be recorded on the request for take-scoped poll. */
  submitReferenceGeneration(prompt: string, conditioningPaths: string[], outputCount: number, aspect: string): Promise<SubmitOutcome & { providerId?: string }>;
  /** Poll a reference image job on its recorded provider; on success returns
   * materialized local paths. */
  pollReferenceGeneration(jobId: string, providerId: string): Promise<{ phase: string; error?: string; resultPaths?: string[] }>;
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
  resolvedVideoProviderId() { return DEFAULT_PROVIDER_ID; },
  providerCapabilities() { return capabilitiesFor(DEFAULT_PROVIDER_ID); },
  providerConfigured() { return false; },
  async submitGeneration() { return { ok: false, blockedReason: 'Live generation needs the desktop app and an API key.' }; },
  async pollGeneration() { return { phase: 'failed', error: 'unavailable' }; },
  imageProviders() { return IMAGE_PROVIDERS.map((p) => ({ id: p.id, label: p.label, role: p.role, bestFor: p.bestFor })); },
  selectedImageProviderId() { return DEFAULT_IMAGE_PROVIDER_ID; },
  setImageProvider() { /* no-op in browser */ },
  resolvedImageProviderId() { return DEFAULT_IMAGE_PROVIDER_ID; },
  imageProviderCapabilities() { return imageCapabilitiesFor(DEFAULT_IMAGE_PROVIDER_ID); },
  async submitReferenceGeneration() { return { ok: false, blockedReason: 'Live reference generation needs the desktop app and an API key.' }; },
  async pollReferenceGeneration() { return { phase: 'failed', error: 'unavailable' }; },
  async runFfmpeg() { return 0; },
  providerIo: null,
};
