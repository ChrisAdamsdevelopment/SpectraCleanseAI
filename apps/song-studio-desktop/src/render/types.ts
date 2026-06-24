// Stable render-engine interface. Kept framework-agnostic so the same render
// logic is shared by the Tauri app (production) and the Node dev/verification
// runner. Do not import React, Tauri, or Node APIs from this file.

export type RenderStatus = 'idle' | 'ready' | 'rendering' | 'success' | 'error';

export interface RenderPreset {
  id: string;
  label: string;
  description: string;
  width: number;
  height: number;
  fps: number;
  maxDurationSec: number;
  /** Whether this preset muxes the song audio (false = silent loop, e.g. Canvas). */
  audio: boolean;
}

export interface RenderJob {
  presetId: string;
  imagePath: string;
  audioPath?: string | null;
  title?: string;
  artist?: string;
  outputPath: string;
  /** Optional override; clamped to the preset's maxDurationSec. */
  durationSec?: number;
}

export interface RenderResult {
  ok: boolean;
  outputPath?: string;
  bytes?: number;
  durationMs?: number;
  error?: string;
}

export type RenderLogFn = (line: string) => void;

/**
 * The one interface the UI depends on. Implementations may run FFmpeg via a
 * Tauri command (production), a bundled sidecar, or a Node child process (dev).
 */
export interface RenderEngine {
  render(job: RenderJob, onLog?: RenderLogFn): Promise<RenderResult>;
}
