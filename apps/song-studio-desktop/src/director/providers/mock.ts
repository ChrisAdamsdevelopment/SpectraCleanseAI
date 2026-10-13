// Deterministic mock video provider — the credential-free automated-test path
// (DEC-003 §J). It exercises the FULL lifecycle without any network or key:
// immediate completion, pending-then-completed, and pending-then-failed, plus
// a synthetic MP4 the assembly harness can actually decode. Never used in the
// shipped UI provider list; created explicitly by tests/harness.

import type { VideoProviderAdapter, ProviderCapabilities, GenerationJobState, SubmitRequest } from './types';

export const mockCapabilities: ProviderCapabilities = {
  textToVideo: true, imageToVideo: true, lastFrame: true, referenceImages: 4,
  humanLikenessReferences: true, characterConsistency: true, videoExtension: true,
  sourceVideoEditing: true, conversationalEditing: true, audioInput: true, lipSync: true,
  durationsSec: [4, 6, 8, 10, 12], maxDurationSec: 30, aspects: ['9:16', '16:9'],
  resolutions: ['720p', '1080p'], async: true, costInfo: 'estimate',
  notes: 'Deterministic in-memory mock for tests. Not a shipped provider.',
};

export type MockMode = 'immediate' | 'pending-then-success' | 'pending-then-fail';

export interface MockController {
  mode: MockMode;
  pollsBeforeDone: number;
  /** A synthetic local MP4 the mock "returns" (written by the harness). */
  resultPath: string;
}

let counter = 0;

/** A mock adapter whose behavior is driven by an explicit controller so tests
 * are deterministic. `download` just returns a fixed byte count; the harness
 * writes the real synthetic MP4 separately. */
export function createMockAdapter(ctrl: MockController): VideoProviderAdapter & { polls: number } {
  const polls = { n: 0 };
  const adapter: VideoProviderAdapter & { polls: number } = {
    id: 'mock', label: 'Mock provider', model: 'mock-1',
    capabilities: mockCapabilities,
    get polls() { return polls.n; },
    isConfigured: () => true,
    async submit(_req: SubmitRequest): Promise<GenerationJobState> {
      counter += 1;
      const jobId = `mock-job-${counter}`;
      if (ctrl.mode === 'immediate') return { jobId, phase: 'succeeded', resultUri: ctrl.resultPath };
      return { jobId, phase: 'submitted' };
    },
    async poll(jobId: string): Promise<GenerationJobState> {
      polls.n += 1;
      if (polls.n < ctrl.pollsBeforeDone) return { jobId, phase: 'running' };
      if (ctrl.mode === 'pending-then-fail') return { jobId, phase: 'failed', error: 'mock generation failed' };
      return { jobId, phase: 'succeeded', resultUri: ctrl.resultPath };
    },
    async download(_uri: string, _toPath: string): Promise<number> { return 1024; },
  };
  return adapter;
}
