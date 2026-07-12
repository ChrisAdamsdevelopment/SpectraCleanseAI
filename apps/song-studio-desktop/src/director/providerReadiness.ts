// Provider readiness (DEC-003 §C — NO SILENT PROVIDER MUTATION).
//
// A creator requirement is never silently removed, clamped, truncated, or
// dropped. Before a live submission we assess the compiled packet against the
// selected provider's truthful capabilities and produce structured items:
//   - ok:        nothing to resolve
//   - warning:   proceed is fine, but the creator should know
//   - blocking:  submission is refused unless the creator picks a visible
//                resolution and (if it changes intent) persists an override
// Each item carries actionable resolutions. `canSubmit` is true only when every
// blocking item is covered by an accepted override. The packet inspector shows
// the exact final request AFTER resolutions.

import type { GenerationPacket } from './compile';
import type { ProviderCapabilities } from './providers/types';

export type ReadinessSeverity = 'ok' | 'warning' | 'blocking';

export interface ReadinessItem {
  id: string;
  severity: ReadinessSeverity;
  message: string;          // director language
  resolutions: string[];    // real actions the creator can take
  /** When set, an acceptedOverrides entry with this key clears the block. */
  overrideKey?: string;
}

export interface ReadinessResult {
  provider: string;
  items: ReadinessItem[];
  blocking: ReadinessItem[];
}

export function assessProviderReadiness(packet: GenerationPacket, caps: ProviderCapabilities, providerLabel: string): ReadinessResult {
  const items: ReadinessItem[] = [];

  // References — NEVER silently "send the first three".
  if (packet.references.length > caps.referenceImages) {
    items.push({
      id: 'too-many-references', severity: 'blocking',
      overrideKey: 'refs:choose',
      message: `This scene selected ${packet.references.length} reference images, but ${providerLabel} accepts at most ${caps.referenceImages}. Song Studio will not silently drop references.`,
      resolutions: [
        `Choose exactly which ${caps.referenceImages} references to send`,
        'Switch to a provider that accepts more references',
        'Export the manual package (no reference limit)',
      ],
    });
  }
  const personRefs = packet.references.filter((r) => r.kind === 'face' || r.kind === 'full-body' || r.kind === 'profile');
  if (personRefs.length > 0 && !caps.humanLikenessReferences) {
    items.push({
      id: 'human-likeness-unsupported', severity: 'blocking',
      overrideKey: 'likeness:accept-loss',
      message: `${providerLabel} does not honor real-person likeness references. Your identity requirement would not be applied.`,
      resolutions: [
        'Switch to a provider that supports likeness references',
        'Export the manual package for a likeness-capable generator',
        'Change the exact identity requirement to consistent/related for this scene',
        'Continue knowingly (likeness not guaranteed)',
      ],
    });
  }

  // Duration — NEVER silently clamp. Block when it exceeds a hard cap.
  if (caps.maxDurationSec !== null && packet.timing.durationSec > caps.maxDurationSec + 1e-6) {
    items.push({
      id: 'duration-exceeds-provider', severity: 'blocking',
      overrideKey: `duration:accept-${caps.maxDurationSec}`,
      message: `You directed a ${packet.timing.durationSec.toFixed(1)}s scene, but ${providerLabel} generates at most ${caps.maxDurationSec}s per clip. Song Studio will not silently shorten your scene.`,
      resolutions: [
        `Split this scene into ${Math.ceil(packet.timing.durationSec / caps.maxDurationSec)} shorter shots`,
        `Explicitly accept a ${caps.maxDurationSec}s generation for this scene`,
        'Switch to a provider that supports longer clips',
        'Export the manual package',
      ],
    });
  }

  // Aspect.
  if (!caps.aspects.includes(packet.aspect)) {
    items.push({
      id: 'aspect-unsupported', severity: 'blocking',
      overrideKey: 'aspect:accept',
      message: `Aspect ${packet.aspect} is not supported by ${providerLabel}.`,
      resolutions: ['Change the scene aspect', 'Switch providers', 'Export the manual package'],
    });
  }

  // Audio conditioning — surface, do not silently omit.
  const hasAudio = packet.files.some((f) => f.kind === 'audio-segment');
  if (hasAudio && !caps.audioInput) {
    items.push({
      id: 'audio-conditioning-unsupported', severity: 'warning',
      overrideKey: 'audio:proceed-without',
      message: `${providerLabel} cannot take the song audio as a conditioning input. Timing will rely on the prompt; the song is still the master audio when the scenes are assembled.`,
      resolutions: [
        'Continue — assemble to the song afterward (recommended)',
        'Switch to an audio-conditioned provider if lip timing matters',
        'Export the manual package for an audio-aware generator',
      ],
    });
  }

  const blocking = items.filter((i) => i.severity === 'blocking');
  return { provider: providerLabel, items, blocking };
}

/** True only when every blocking item is covered by an accepted override. */
export function canSubmit(result: ReadinessResult, acceptedOverrides: string[]): boolean {
  return result.blocking.every((b) => b.overrideKey !== undefined && acceptedOverrides.includes(b.overrideKey));
}

/** The exact override keys still required before this packet may submit. */
export function unresolvedOverrideKeys(result: ReadinessResult, acceptedOverrides: string[]): string[] {
  return result.blocking
    .map((b) => b.overrideKey)
    .filter((k): k is string => Boolean(k) && !acceptedOverrides.includes(k as string));
}
