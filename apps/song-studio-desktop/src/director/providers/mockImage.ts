// Deterministic mock image provider (VIDEO-003B §1/§9) — credential-free test
// path for the reference-variant lifecycle. Immediate or pending-then-done, plus
// a fixed synthetic result path list the harness can materialize. Never shown in
// the shipped provider list; created explicitly by tests/harness.

import type { ImageProviderAdapter, ImageProviderCapabilities, ImageJobState, ImageSubmitRequest } from './types';

export const mockImageCapabilities: ImageProviderCapabilities = {
  referenceImages: 4, humanLikenessReferences: true, maxOutputs: 4, editing: true,
  aspects: ['9:16', '16:9', '1:1'], async: true, notes: 'Deterministic in-memory mock for tests. Not a shipped provider.',
};

export interface MockImageController {
  mode: 'immediate' | 'pending-then-success' | 'pending-then-fail';
  pollsBeforeDone: number;
  resultPaths: string[];   // synthetic images the mock "returns" (as uris)
}

let counter = 0;

export function createMockImageAdapter(ctrl: MockImageController): ImageProviderAdapter & { polls: number } {
  const polls = { n: 0 };
  const adapter: ImageProviderAdapter & { polls: number } = {
    id: 'mock-image', label: 'Mock image', model: 'mock-img-1',
    capabilities: mockImageCapabilities,
    get polls() { return polls.n; },
    isConfigured: () => true,
    async submit(req: ImageSubmitRequest): Promise<ImageJobState> {
      counter += 1;
      const jobId = `mock-img-job-${counter}`;
      const uris = ctrl.resultPaths.slice(0, Math.max(1, req.outputCount));
      if (ctrl.mode === 'immediate') return { jobId, phase: 'succeeded', resultUris: uris };
      return { jobId, phase: 'submitted' };
    },
    async poll(jobId: string): Promise<ImageJobState> {
      polls.n += 1;
      if (polls.n < ctrl.pollsBeforeDone) return { jobId, phase: 'running' };
      if (ctrl.mode === 'pending-then-fail') return { jobId, phase: 'failed', error: 'mock image generation failed' };
      return { jobId, phase: 'succeeded', resultUris: ctrl.resultPaths };
    },
    async download(_uri: string, _toPath: string): Promise<number> { return 2048; },
  };
  return adapter;
}
