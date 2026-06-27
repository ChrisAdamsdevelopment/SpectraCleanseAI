import { mkdtempSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export interface CanvasWorkspacePaths {
  root: string;
  sourceClipsDir: string;
  framesDir: string;
  anchorFramesDir: string;
  reportsDir: string;
  exportsDir: string;
}

export interface CreateCanvasWorkspaceOptions {
  baseDir?: string;
  prefix?: string;
}

function ensureDir(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}

/**
 * Creates an internal Canvas harness workspace under a safe temp/cache location.
 *
 * By default this uses the OS temp directory so generated clips, frames, exports,
 * and JSON reports stay outside Git. CANVAS_LAB_DIR is reserved as an explicit
 * opt-in override for future local lab runs and must point to a caller-controlled
 * cache/output directory; no external-drive paths are hardcoded here.
 */
export function createCanvasWorkspace(options: CreateCanvasWorkspaceOptions = {}): CanvasWorkspacePaths {
  const baseDir = resolve(options.baseDir ?? process.env.CANVAS_LAB_DIR ?? tmpdir());
  ensureDir(baseDir);
  const root = mkdtempSync(join(baseDir, options.prefix ?? 'song-studio-canvas-'));
  const sourceClipsDir = ensureDir(join(root, 'source-clips'));
  const framesDir = ensureDir(join(root, 'frames'));
  const anchorFramesDir = ensureDir(join(root, 'anchor-frames'));
  const reportsDir = ensureDir(join(root, 'reports'));
  const exportsDir = ensureDir(join(root, 'exports'));
  return { root, sourceClipsDir, framesDir, anchorFramesDir, reportsDir, exportsDir };
}

export function canvasWorkspacePath(workspace: CanvasWorkspacePaths, kind: 'source' | 'framePattern' | 'candidatePattern' | 'anchor' | 'report' | 'export', name: string): string {
  switch (kind) {
    case 'source': return join(workspace.sourceClipsDir, name);
    case 'framePattern': return join(workspace.framesDir, name);
    case 'candidatePattern': return join(workspace.framesDir, name);
    case 'anchor': return join(workspace.anchorFramesDir, name);
    case 'report': return join(workspace.reportsDir, name);
    case 'export': return join(workspace.exportsDir, name);
  }
}
