import { CREATIVE_FUNCTIONS, getFunction } from '../render/recipes';
import type { ProjectOutput, ReleaseProject } from './types';

export type OutputReadinessState = 'not-started' | 'draft' | 'created' | 'needs-attention';
export type EffectiveOutputState = Exclude<OutputReadinessState, 'not-started'>;
export type NextReleaseActionKind = 'add-song' | 'add-cover' | 'create-first-output' | 'fix-output' | 'continue-output' | 'create-output-type' | 'review-or-variant';

export interface OutputTypeReadiness {
  functionId: string;
  label: string;
  description: string;
  audioRequired: boolean;
  state: OutputReadinessState;
  outputs: ProjectOutput[];
  createdCount: number;
  draftCount: number;
  needsAttentionCount: number;
}

export interface ReleaseNextAction {
  kind: NextReleaseActionKind;
  title: string;
  detail: string;
  functionId?: string;
  outputId?: string;
}

export interface ReleaseReadiness {
  essentialsAdded: number;
  essentialsTotal: number;
  hasSong: boolean;
  hasCover: boolean;
  totalOutputs: number;
  createdOutputs: number;
  draftOutputs: number;
  needsAttentionOutputs: number;
  supportedOutputTypes: number;
  unstartedOutputTypes: number;
  outputTypes: OutputTypeReadiness[];
  nextAction: ReleaseNextAction;
}

export function deriveReleaseReadiness(project: ReleaseProject): ReleaseReadiness {
  const hasSong = Boolean(project.audioPath);
  const hasCover = Boolean(project.coverPath);
  const outputs = project.outputs;
  const outputStates = outputs.map((output) => ({ output, state: effectiveOutputState(output) }));
  const outputTypes = CREATIVE_FUNCTIONS.map((fn): OutputTypeReadiness => {
    const matchingStates = outputStates.filter(({ output }) => output.functionId === fn.id);
    const matching = matchingStates.map(({ output }) => output);
    const needsAttentionCount = matchingStates.filter(({ state }) => state === 'needs-attention').length;
    const draftCount = matchingStates.filter(({ state }) => state === 'draft').length;
    const createdCount = matchingStates.filter(({ state }) => state === 'created').length;
    return {
      functionId: fn.id,
      label: fn.label,
      description: fn.description,
      audioRequired: fn.audio,
      state: outputTypeState(matching),
      outputs: matching,
      createdCount,
      draftCount,
      needsAttentionCount,
    };
  });

  const needsAttentionOutput = outputStates.find(({ state }) => state === 'needs-attention')?.output;
  const draftOutput = outputStates.find(({ state }) => state === 'draft')?.output;
  const firstUnstartedType = outputTypes.find((type) => type.state === 'not-started');
  const firstFunction = CREATIVE_FUNCTIONS[0];

  return {
    essentialsAdded: [hasSong, hasCover].filter(Boolean).length,
    essentialsTotal: 2,
    hasSong,
    hasCover,
    totalOutputs: outputs.length,
    createdOutputs: outputStates.filter(({ state }) => state === 'created').length,
    draftOutputs: outputStates.filter(({ state }) => state === 'draft').length,
    needsAttentionOutputs: outputStates.filter(({ state }) => state === 'needs-attention').length,
    supportedOutputTypes: CREATIVE_FUNCTIONS.length,
    unstartedOutputTypes: outputTypes.filter((type) => type.state === 'not-started').length,
    outputTypes,
    nextAction: !hasSong ? {
      kind: 'add-song', title: 'Add your song', detail: 'Start with the finished track this release project will promote.',
    } : !hasCover ? {
      kind: 'add-cover', title: 'Add cover art', detail: 'Your cover art becomes the shared visual foundation for every current Output.',
    } : outputs.length === 0 && firstFunction ? {
      kind: 'create-first-output', functionId: firstFunction.id, title: 'Create your first Output', detail: `${firstFunction.label} is a good first deliverable from this release project.`,
    } : needsAttentionOutput ? {
      kind: 'fix-output', outputId: needsAttentionOutput.id, title: 'Fix the Output that needs attention', detail: `${needsAttentionOutput.name} hit an error. Open it, review the problem, and try again.`,
    } : draftOutput ? {
      kind: 'continue-output', outputId: draftOutput.id, title: 'Continue your draft Output', detail: `${draftOutput.name} has not been created yet. Open it to review and render.`,
    } : firstUnstartedType ? {
      kind: 'create-output-type', functionId: firstUnstartedType.functionId, title: 'Create another Output type', detail: `${firstUnstartedType.label} has not been started for this release project.`,
    } : {
      kind: 'review-or-variant', outputId: outputs[0]?.id, title: 'Review what you made', detail: 'Every current Output type has at least one version. Open one now, or use Create another below when you want a variation.',
    },
  };
}

export function effectiveOutputState(output: ProjectOutput): EffectiveOutputState {
  if (output.status === 'error') return 'needs-attention';
  if (output.status === 'rendered' && output.lastRender) return 'created';
  return 'draft';
}

function outputTypeState(outputs: ProjectOutput[]): OutputReadinessState {
  if (outputs.length === 0) return 'not-started';
  const states = outputs.map(effectiveOutputState);
  if (states.some((state) => state === 'needs-attention')) return 'needs-attention';
  if (states.some((state) => state === 'draft')) return 'draft';
  return 'created';
}

export function readinessStatusLabel(state: OutputReadinessState): string {
  if (state === 'not-started') return 'Not started';
  if (state === 'needs-attention') return 'Needs attention';
  if (state === 'created') return 'Created';
  return 'Draft';
}

export function readinessStatusClass(state: OutputReadinessState): string {
  if (state === 'not-started') return 'not-started';
  if (state === 'needs-attention') return 'error';
  if (state === 'created') return 'rendered';
  return 'draft';
}

export function outputTypeName(functionId: string): string {
  return getFunction(functionId)?.label ?? functionId;
}

export function outputActionLabel(output: ProjectOutput): string {
  const state = effectiveOutputState(output);
  if (state === 'needs-attention') return 'Fix Output';
  if (state === 'created') return 'Open';
  return 'Continue';
}
