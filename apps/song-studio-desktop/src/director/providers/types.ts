// Provider adapter boundary (DEC-003). Providers are described by CAPABILITIES;
// the UI and compiler consume capabilities, never provider assumptions. A
// capability conflict is SURFACED to the creator (see compile.checkProviderFit)
// — requirements are never silently dropped.

export interface ProviderCapabilities {
  textToVideo: boolean;
  imageToVideo: boolean;            // first-frame conditioning
  lastFrame: boolean;
  referenceImages: number;          // max supported reference images (0 = none)
  humanLikenessReferences: boolean; // real-person likeness via references
  characterConsistency: boolean;
  videoExtension: boolean;
  sourceVideoEditing: boolean;
  audioInput: boolean;              // can condition on an audio track
  lipSync: boolean;                 // dialogue / lip-sync support
  durationsSec: number[];           // supported clip durations
  aspects: string[];                // e.g. ['16:9','9:16']
  resolutions: string[];
  async: boolean;                   // long-running job + polling
  costInfo: 'none' | 'estimate' | 'reported';
  notes: string;
}

export type JobPhase = 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface GenerationJobState {
  jobId: string;          // provider operation name
  phase: JobPhase;
  error?: string;
  /** Provider-side URI of the generated video when succeeded. */
  resultUri?: string;
  raw?: unknown;
}

export interface SubmitRequest {
  prompt: string;
  negative?: string;
  aspect: '9:16' | '16:9';
  resolution: string;
  durationSec: number;
  /** Local file paths of reference images, in packet order. */
  referenceImagePaths: string[];
  firstFramePath?: string;
  lastFramePath?: string;
}

export interface VideoProviderAdapter {
  id: string;
  label: string;
  model: string;
  capabilities: ProviderCapabilities;
  isConfigured(): boolean;
  submit(req: SubmitRequest): Promise<GenerationJobState>;
  poll(jobId: string): Promise<GenerationJobState>;
  /** Download the succeeded result to a local file path; returns bytes. */
  download(resultUri: string, toPath: string): Promise<number>;
}

export interface TextModelAdapter {
  id: string;
  isConfigured(): boolean;
  /** Ask the model for a structured directing-tool definition (JSON text). */
  generateToolDefinition(request: string, refinement?: string, previousJson?: string): Promise<string>;
}
