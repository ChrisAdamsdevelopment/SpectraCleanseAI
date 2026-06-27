import type { AIProviderCapabilities, AIProviderEstimate, AIProviderJob, CanvasValidationIssue, LoopAnchor } from '../types';

export interface AIProviderInterface {
  getProviderCapabilities(): AIProviderCapabilities;
  estimateCost(job: AIProviderJob): AIProviderEstimate;
  validateInputs(job: AIProviderJob): CanvasValidationIssue[];
  generateLoopFromAnchor(job: AIProviderJob): Promise<AIProviderJob>;
  repairLoopSeam(job: AIProviderJob): Promise<AIProviderJob>;
  extendVideoToAnchor(job: AIProviderJob): Promise<AIProviderJob>;
  generateTransitionFrames(job: AIProviderJob): Promise<AIProviderJob>;
  createVariations(job: AIProviderJob, count: number): Promise<AIProviderJob[]>;
}

export function createAIProviderJob(anchor: LoopAnchor, inputPath?: string): AIProviderJob {
  return { id: `mock-${anchor.sourceId}-${anchor.timestampSec}`, inputPath, anchor, createdAt: new Date().toISOString(), status: 'planned' };
}
