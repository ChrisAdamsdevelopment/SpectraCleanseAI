// Provider-neutral registry (DEC-003 §A). The UI selects providers and reads
// truthful CAPABILITIES here — it never imports Google constants or embeds
// provider names in logic. Default: Gemini Omni Flash. Secondary: Veo. The
// manual package is a first-class peer path handled outside this registry.

import type { ProviderCapabilities, ImageProviderCapabilities } from './types';
import { omniFlashCapabilities } from './omniFlash';
import { googleVideoCapabilities } from './googleVideo';
import { geminiImageCapabilities } from './geminiImage';
import { xaiVideoCapabilities, xaiImageCapabilities } from './xai';

export interface ProviderDescriptor {
  id: string;
  label: string;
  role: 'default' | 'specialist' | 'manual';
  capabilities: ProviderCapabilities;
  /** One-line director-language note on when to reach for this provider. */
  bestFor: string;
  /** Which account/credential this provider draws on (for the settings UI). */
  account?: 'google' | 'xai' | 'none';
}

export const MANUAL_CAPS: ProviderCapabilities = {
  textToVideo: true, imageToVideo: true, lastFrame: true, referenceImages: 999,
  humanLikenessReferences: true, characterConsistency: true, videoExtension: true,
  sourceVideoEditing: true, conversationalEditing: false, audioInput: true, lipSync: true,
  durationsSec: [], maxDurationSec: null, aspects: ['9:16', '16:9'],
  resolutions: ['720p', '1080p', '4k'], async: false, costInfo: 'none',
  notes: 'You generate externally with any tool, then import the MP4. No limits imposed by Song Studio.',
};

export const PROVIDERS: ProviderDescriptor[] = [
  { id: 'google-omni', label: 'Gemini Omni Flash', role: 'default', capabilities: omniFlashCapabilities, bestFor: 'Default. Multimodal scenes, conversational edits, source-video repair.', account: 'google' },
  { id: 'google-veo', label: 'Google Veo', role: 'specialist', capabilities: googleVideoCapabilities, bestFor: 'Scene extension and last-frame control; fixed 4/6/8s clips.', account: 'google' },
  { id: 'xai-video', label: 'Grok Imagine (video)', role: 'specialist', capabilities: xaiVideoCapabilities, bestFor: 'Grok scenes up to 15s from text or a starting image.', account: 'xai' },
  { id: 'manual', label: 'Manual package', role: 'manual', capabilities: MANUAL_CAPS, bestFor: 'Export the exact request; generate anywhere; import the result.', account: 'none' },
];

export const DEFAULT_PROVIDER_ID = 'google-omni';

/** Which account a provider needs — drives the Settings connect/disconnect UI. */
export function providerAccount(id: string): 'google' | 'xai' | 'none' {
  return providerDescriptor(id).account ?? 'none';
}

export function providerDescriptor(id: string): ProviderDescriptor {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export function capabilitiesFor(id: string): ProviderCapabilities {
  return providerDescriptor(id).capabilities;
}

// ── Image providers (reference-variant generation, §1) ──────────────────────
export interface ImageProviderDescriptor {
  id: string;
  label: string;
  role: 'default' | 'specialist' | 'manual';
  capabilities: ImageProviderCapabilities;
  bestFor: string;
  account?: 'google' | 'xai' | 'none';
}

export const MANUAL_IMAGE_CAPS: ImageProviderCapabilities = {
  referenceImages: 999, humanLikenessReferences: true, maxOutputs: 99, editing: true,
  aspects: ['9:16', '16:9', '1:1'], async: false, notes: 'Export the request, generate anywhere, import the proposal.',
};

export const IMAGE_PROVIDERS: ImageProviderDescriptor[] = [
  { id: 'gemini-image', label: 'Gemini image', role: 'default', capabilities: geminiImageCapabilities, bestFor: 'Default. Identity-guided reference variants (proposals).', account: 'google' },
  { id: 'xai-image', label: 'Grok Imagine (image)', role: 'specialist', capabilities: xaiImageCapabilities, bestFor: 'Grok reference variants; edits up to 3 source images, up to 10 variants.', account: 'xai' },
  { id: 'manual', label: 'Manual package', role: 'manual', capabilities: MANUAL_IMAGE_CAPS, bestFor: 'Generate references anywhere; import the proposal.', account: 'none' },
];

export function imageProviderAccount(id: string): 'google' | 'xai' | 'none' {
  return imageProviderDescriptor(id).account ?? 'none';
}

// ── 'Auto' resolution (§6/§9) ───────────────────────────────────────────────
// 'auto' picks the best CONNECTED provider by declared capability — it never
// pretends an unconnected provider is available and never invents capability.

export interface ConnectedAccounts { google: boolean; xai: boolean }

/** Resolve a video provider preference ('auto' | provider id) to a concrete id.
 * Falls back to 'manual' when nothing is connected — the always-available path. */
export function resolveVideoProvider(pref: string, connected: ConnectedAccounts): string {
  if (pref !== 'auto') return pref;
  if (connected.google) return 'google-omni';
  if (connected.xai) return 'xai-video';
  return 'manual';
}

/** Resolve an image provider preference to a concrete id. */
export function resolveImageProvider(pref: string, connected: ConnectedAccounts): string {
  if (pref !== 'auto') return pref;
  if (connected.google) return 'gemini-image';
  if (connected.xai) return 'xai-image';
  return 'manual';
}

/** Resolve the provider for a REPAIR (needs documented source-video editing).
 * Only Omni declares sourceVideoEditing today; Grok does not, so 'auto' will not
 * route a repair to Grok and silently produce a regeneration instead. */
export function resolveRepairProvider(pref: string, connected: ConnectedAccounts): string {
  if (pref !== 'auto') return pref;
  const capable = PROVIDERS.filter((p) => p.capabilities.sourceVideoEditing && p.role !== 'manual');
  for (const p of capable) {
    if (p.account === 'google' && connected.google) return p.id;
    if (p.account === 'xai' && connected.xai) return p.id;
  }
  return 'manual';
}

export const DEFAULT_IMAGE_PROVIDER_ID = 'gemini-image';

export function imageProviderDescriptor(id: string): ImageProviderDescriptor {
  return IMAGE_PROVIDERS.find((p) => p.id === id) ?? IMAGE_PROVIDERS[0];
}
export function imageCapabilitiesFor(id: string): ImageProviderCapabilities {
  return imageProviderDescriptor(id).capabilities;
}
