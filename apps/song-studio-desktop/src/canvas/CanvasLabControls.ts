import type { LoopRepairMethod } from './types';

// The Canvas Lab control surface. This is the contract a CLI operator drives
// today and that the future desktop UI and AI agents will drive tomorrow — they
// will set these controls instead of touching engine internals. Pure data: no
// Node/FFmpeg/network imports, safe to share with the frontend.

export type CanvasLoopLabMode = 'logic-only' | 'ffmpeg';

/** 'auto' defers to the LoopReadiness-recommended method; otherwise a fixed method. */
export type CanvasLabMethodChoice = 'auto' | LoopRepairMethod;

export interface CanvasLabControls {
  mode: CanvasLoopLabMode;
  /** Local source video. When omitted, the lab generates a synthetic fixture (back-compat). */
  inputPath?: string;
  /** Local output/workspace directory. When omitted, an OS temp workspace is used. Local paths only — never a cloud target. */
  outputDir?: string;
  anchorTimeSec?: number;
  minDurationSec?: number;
  maxDurationSec?: number;
  topN?: number;
  minSimilarityScore?: number;
  /** 'auto' (default) uses the recommended method; a fixed method forces it. */
  method?: CanvasLabMethodChoice;
  /** Execute/plan every local repair method and report a comparison. */
  compareMethods?: boolean;
  /** Fixture length when no inputPath is supplied (ffmpeg mode). */
  fixtureDurationSec?: number;
}

export const CANVAS_LAB_METHODS: LoopRepairMethod[] = ['hard-cut', 'crossfade', 'ping-pong', 'frame-blend'];

export function isLoopRepairMethod(value: string): value is LoopRepairMethod {
  return (CANVAS_LAB_METHODS as string[]).includes(value);
}
