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
  conversationalEditing: boolean;   // multi-turn refine via prior interaction id
  audioInput: boolean;              // can condition on an audio track
  lipSync: boolean;                 // dialogue / lip-sync support
  durationsSec: number[];           // discrete supported durations (empty = provider-inferred)
  /** Hard max seconds the provider will generate in one clip; null = provider
   * infers duration (no fixed cap). Readiness BLOCKS a longer scene rather than
   * clamping — a creator requirement is never silently shortened. */
  maxDurationSec: number | null;
  aspects: string[];                // e.g. ['16:9','9:16']
  resolutions: string[];
  async: boolean;                   // long-running job + polling
  costInfo: 'none' | 'estimate' | 'reported';
  notes: string;
}

export type JobPhase = 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface GenerationJobState {
  jobId: string;          // provider operation / interaction id
  phase: JobPhase;
  error?: string;
  /** Provider-side URI of the generated video when succeeded (large results). */
  resultUri?: string;
  /** Inline base64 MP4 when the provider returned the video directly (small). */
  resultInlineBase64?: string;
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
  /** Source MP4 for edit/repair (source-video editing providers). */
  sourceVideoPath?: string;
  /** Prior interaction id for conversational multi-turn repair. */
  parentInteractionId?: string;
}

/** Host-injected IO so adapters never monkey-patch globals. Absent in the
 * browser fallback (adapters then report a clear blocked reason). */
export interface ProviderIo {
  readBase64(path: string): Promise<string>;
  mimeType(path: string): string;
  fetchJson(url: string, init: { method?: string; headers?: Record<string, string>; body?: string }): Promise<{ ok: boolean; status: number; text: string; json: unknown }>;
  downloadToFile(uri: string, headers: Record<string, string>, toPath: string): Promise<number>;
  /** Decode an inline base64 MP4 to a local file; returns bytes written. */
  writeBase64ToFile(base64: string, toPath: string): Promise<number>;
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
