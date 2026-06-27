import type { AIProviderCapabilities, AIProviderEstimate, AIProviderJob, CanvasValidationIssue } from '../types';
import type { AIProviderInterface } from './AIProviderInterface';

export class MockAIProvider implements AIProviderInterface {
  public calls: string[] = [];

  getProviderCapabilities(): AIProviderCapabilities {
    return { providerId: 'mock-ai-provider', displayName: 'Mock AI Provider (offline)', supportsPortrait916: true, supportsFirstFrame: true, supportsLastFrame: true, supportsSameAnchorFirstLast: true, supportsExtension: true, supportedDurationsSec: [4, 6, 8], supportedResolutions: ['720x1280', '1080x1920'], requiresNetwork: false, requiresPaidRequest: false, provenanceRequirements: ['mock-output-only'] };
  }

  estimateCost(_job: AIProviderJob): AIProviderEstimate { return { providerId: 'mock-ai-provider', estimatedCostUsd: 0, estimatedSeconds: 0, notes: ['Mock provider performs no network or paid API work.'] }; }
  validateInputs(_job: AIProviderJob): CanvasValidationIssue[] { return []; }
  async generateLoopFromAnchor(job: AIProviderJob): Promise<AIProviderJob> { return this.record('generateLoopFromAnchor', job); }
  async repairLoopSeam(job: AIProviderJob): Promise<AIProviderJob> { return this.record('repairLoopSeam', job); }
  async extendVideoToAnchor(job: AIProviderJob): Promise<AIProviderJob> { return this.record('extendVideoToAnchor', job); }
  async generateTransitionFrames(job: AIProviderJob): Promise<AIProviderJob> { return this.record('generateTransitionFrames', job); }
  async createVariations(job: AIProviderJob, count: number): Promise<AIProviderJob[]> { this.calls.push('createVariations'); return Array.from({ length: count }, (_, index) => ({ ...job, id: `${job.id}-variation-${index + 1}`, status: 'succeeded' })); }

  private async record(name: string, job: AIProviderJob): Promise<AIProviderJob> { this.calls.push(name); return { ...job, status: 'succeeded' }; }
}
