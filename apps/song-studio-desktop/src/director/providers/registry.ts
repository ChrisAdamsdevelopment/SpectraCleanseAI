// Provider-neutral registry (DEC-003 §A). The UI selects providers and reads
// truthful CAPABILITIES here — it never imports Google constants or embeds
// provider names in logic. Default: Gemini Omni Flash. Secondary: Veo. The
// manual package is a first-class peer path handled outside this registry.

import type { ProviderCapabilities } from './types';
import { omniFlashCapabilities } from './omniFlash';
import { googleVideoCapabilities } from './googleVideo';

export interface ProviderDescriptor {
  id: string;
  label: string;
  role: 'default' | 'specialist' | 'manual';
  capabilities: ProviderCapabilities;
  /** One-line director-language note on when to reach for this provider. */
  bestFor: string;
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
  { id: 'google-omni', label: 'Gemini Omni Flash', role: 'default', capabilities: omniFlashCapabilities, bestFor: 'Default. Multimodal scenes, conversational edits, source-video repair.' },
  { id: 'google-veo', label: 'Google Veo', role: 'specialist', capabilities: googleVideoCapabilities, bestFor: 'Scene extension and last-frame control; fixed 4/6/8s clips.' },
  { id: 'manual', label: 'Manual package', role: 'manual', capabilities: MANUAL_CAPS, bestFor: 'Export the exact request; generate anywhere; import the result.' },
];

export const DEFAULT_PROVIDER_ID = 'google-omni';

export function providerDescriptor(id: string): ProviderDescriptor {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export function capabilitiesFor(id: string): ProviderCapabilities {
  return providerDescriptor(id).capabilities;
}
