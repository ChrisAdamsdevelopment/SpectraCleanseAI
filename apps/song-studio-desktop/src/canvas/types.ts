export type CanvasValidationSeverity = 'error' | 'warning';
export type CanvasAspectRatio = '9:16' | '16:9' | '1:1' | 'custom';
export type LoopRepairMethod = 'hard-cut' | 'crossfade' | 'ping-pong' | 'frame-blend';

export interface CanvasVideoSpec {
  filePath: string;
  fileType?: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  codec?: string;
  fileSizeBytes?: number;
}

export interface CanvasValidationRule {
  id: string;
  label: string;
  severity: CanvasValidationSeverity;
  validate: (spec: CanvasVideoSpec) => boolean;
  message: string;
}

export interface CanvasValidationIssue {
  ruleId: string;
  severity: CanvasValidationSeverity;
  message: string;
}

export interface CanvasValidationResult {
  ok: boolean;
  errors: CanvasValidationIssue[];
  warnings: CanvasValidationIssue[];
  spec: CanvasVideoSpec;
}

export interface LoopAnchor {
  sourceId: string;
  sourceFilePath?: string;
  timestampSec: number;
  frameIndex?: number;
  previewFramePath?: string;
  notes?: string;
  createdAt: string;
}

export interface ExtractedFrame {
  sourceId: string;
  framePath?: string;
  timestampSec: number;
  frameIndex: number;
  width?: number;
  height?: number;
  fps?: number;
  checksum?: string;
  metrics?: FrameMetrics;
}

export interface FrameMetrics {
  visualSimilarity?: number;
  brightness?: number;
  colorVector?: [number, number, number];
  motionMagnitude?: number;
}

export interface LoopScore {
  visualSimilarity: number;
  brightnessContinuity: number;
  colorContinuity: number;
  motionContinuity: number;
  durationFit: number;
  jumpRisk: number;
  overall: number;
  reasons: string[];
}

export interface LoopCandidate {
  anchor: LoopAnchor;
  endFrame: ExtractedFrame;
  loopDurationSec: number;
  score: LoopScore;
  rank: number;
  reasons: string[];
}

export interface LoopExportRequest {
  inputPath: string;
  outputPath: string;
  anchor: LoopAnchor;
  candidate: LoopCandidate;
  method: LoopRepairMethod;
  targetWidth?: number;
  targetHeight?: number;
  targetFps?: number;
  crossfadeSec?: number;
}

export interface FfmpegCommandPlan {
  args: string[];
  outputPath?: string;
  description: string;
  requiresExecutionHook: 'run_ffmpeg';
}

export interface LoopExportResult {
  ok: boolean;
  request: LoopExportRequest;
  plan: FfmpegCommandPlan;
  outputPath?: string;
  bytes?: number;
  warnings: string[];
}

export interface CanvasLoopReport {
  inputFile: string;
  validation: CanvasValidationResult;
  anchorTimeSec: number;
  candidateEndTimeSec?: number;
  loopDurationSec?: number;
  score?: LoopScore;
  methodSelected?: LoopRepairMethod;
  warnings: string[];
  exportPath?: string;
  ai: { used: boolean; providerId?: string; note: string };
  provenance: { engineVersion: string; generatedAt: string; aiJobId?: string; source?: string };
}

export interface AIProviderCapabilities {
  providerId: string;
  displayName: string;
  supportsPortrait916: boolean;
  supportsFirstFrame: boolean;
  supportsLastFrame: boolean;
  supportsSameAnchorFirstLast: boolean;
  supportsExtension: boolean;
  supportedDurationsSec: number[];
  supportedResolutions: string[];
  requiresNetwork: boolean;
  requiresPaidRequest: boolean;
  provenanceRequirements: string[];
}

export interface AIProviderJob {
  id: string;
  inputPath?: string;
  anchor: LoopAnchor;
  prompt?: string;
  durationSec?: number;
  createdAt: string;
  status: 'planned' | 'queued' | 'running' | 'succeeded' | 'failed';
}

export interface AIProviderEstimate {
  providerId: string;
  estimatedCostUsd: number;
  estimatedSeconds: number;
  notes: string[];
}
