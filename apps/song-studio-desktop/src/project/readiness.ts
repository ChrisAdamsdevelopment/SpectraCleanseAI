import { CREATIVE_FUNCTIONS, getFunction } from '../render/recipes';
import type { ProjectOutput, ReleaseProject } from './types';

export type OutputReadinessState = 'not-started' | 'draft' | 'created' | 'needs-attention';
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
  const outputTypes = CREATIVE_FUNCTIONS.map((fn): OutputTypeReadiness => {
    const matching = outputs.filter((output) => output.functionId === fn.id);
    const needsAttentionCount = matching.filter((output) => output.status === 'error').length;
    const draftCount = matching.filter((output) => output.status === 'draft').length;
    const createdCount = matching.filter((output) => output.status === 'rendered' && output.lastRender).length;
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

  const needsAttentionOutput = outputs.find((output) => output.status === 'error');
  const draftOutput = outputs.find((output) => output.status === 'draft');
  const firstUnstartedType = outputTypes.find((type) => type.state === 'not-started');
  const firstFunction = CREATIVE_FUNCTIONS[0];

  return {
    essentialsAdded: [hasSong, hasCover].filter(Boolean).length,
    essentialsTotal: 2,
    hasSong,
    hasCover,
    totalOutputs: outputs.length,
    createdOutputs: outputs.filter((output) => output.status === 'rendered' && output.lastRender).length,
    draftOutputs: outputs.filter((output) => output.status === 'draft').length,
    needsAttentionOutputs: outputs.filter((output) => output.status === 'error').length,
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
      kind: 'fix-output', outputId: needsAttentionOutput.id, title: 'Fix the Output that needs attention', detail: `${needsAttentionOutput.name} hit an error. Open it and try creating the MP4 again.`,
    } : draftOutput ? {
      kind: 'continue-output', outputId: draftOutput.id, title: 'Continue your draft Output', detail: `${draftOutput.name} has not been created yet. Open it to review and render.`,
    } : firstUnstartedType ? {
      kind: 'create-output-type', functionId: firstUnstartedType.functionId, title: 'Create another Output type', detail: `${firstUnstartedType.label} has not been started for this release project.`,
    } : {
      kind: 'review-or-variant', outputId: outputs[0]?.id, title: 'Review what you made or create a variation', detail: 'Every current Output type has at least one version. Open an Output or make another variation.',
    },
  };
}

function outputTypeState(outputs: ProjectOutput[]): OutputReadinessState {
  if (outputs.length === 0) return 'not-started';
  if (outputs.some((output) => output.status === 'error')) return 'needs-attention';
  if (outputs.some((output) => output.status === 'draft')) return 'draft';
  if (outputs.some((output) => output.status === 'rendered' && output.lastRender)) return 'created';
  return 'draft';
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
