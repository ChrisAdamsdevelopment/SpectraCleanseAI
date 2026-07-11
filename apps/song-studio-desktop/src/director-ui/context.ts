import type { DirectorState } from '../director/model';
import type { DirectorHost } from '../director/hostIo';
import type { ToolValidation } from '../director/toolSchema';

// Everything the Director UI needs from App, in one prop bag. The UI mutates
// DirectorState only through `update` (App persists it on ReleaseProject).
export interface DirectorCtx {
  state: DirectorState;
  update: (next: DirectorState) => void;
  host: DirectorHost;
  songDurationSec: number | null;
  audioPath: string | null;
  outputDir: string | null;
  width: number;
  height: number;
  fps: number;
  /** Register a project asset (reference / generated-video), returns its id. */
  addAsset: (role: 'artist-photo' | 'footage' | 'generated-video' | 'reference', path: string, label: string) => string;
  assetPath: (assetId: string) => string | null;
  /** Text-model tool generation (may be blocked); returns validation. */
  textModelConfigured: boolean;
  generateTool: (request: string, refinement?: string, previousJson?: string) => Promise<ToolValidation & { rawPrompt: string }>;
}
