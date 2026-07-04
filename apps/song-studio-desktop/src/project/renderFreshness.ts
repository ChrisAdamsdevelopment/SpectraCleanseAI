import { getFunction } from '../render/recipes';
import type { OutputLastRender, ProjectOutput } from './types';

export type SharedRenderInput = 'audioPath' | 'coverPath' | 'title' | 'artist' | 'outputDir' | 'songAnalysis';

export interface RenderAttempt {
  outputId: string;
  renderRevision: number;
}

export function invalidateOutputRender(output: ProjectOutput): ProjectOutput {
  return { ...output, status: 'draft', lastRender: null, renderRevision: output.renderRevision + 1 };
}

export function applySuccessfulRender(output: ProjectOutput, lastRender: OutputLastRender): ProjectOutput {
  return { ...output, status: 'rendered', lastRender };
}

export function applyFailedRender(output: ProjectOutput): ProjectOutput {
  return { ...output, status: 'error' };
}

export function isKnownSupportedOutput(output: ProjectOutput): boolean {
  return Boolean(getFunction(output.functionId));
}

export function outputUsesAudio(output: ProjectOutput): boolean {
  return Boolean(getFunction(output.functionId)?.audio);
}

export function outputUsesCover(output: ProjectOutput): boolean {
  return isKnownSupportedOutput(output);
}

export function outputUsesTitle(output: ProjectOutput): boolean {
  return isKnownSupportedOutput(output);
}

export function shouldInvalidateForSharedInput(output: ProjectOutput, input: SharedRenderInput): boolean {
  if (!isKnownSupportedOutput(output)) return false;
  if (input === 'coverPath') return outputUsesCover(output);
  if (input === 'audioPath') return outputUsesAudio(output);
  if (input === 'title') return outputUsesTitle(output);
  return false;
}

export function invalidateOutputsForSharedInput(outputs: ProjectOutput[], input: SharedRenderInput): ProjectOutput[] {
  return outputs.map((output) => (shouldInvalidateForSharedInput(output, input) ? invalidateOutputRender(output) : output));
}

export function canApplyRenderAttempt(output: ProjectOutput, attempt: RenderAttempt): boolean {
  return output.id === attempt.outputId && output.renderRevision === attempt.renderRevision;
}
