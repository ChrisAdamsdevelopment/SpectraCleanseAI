import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { RenderEngine, RenderJob, RenderResult, RenderLogFn, FfmpegStatus } from './types';
import { getRecipe } from './recipes';
import { getTemplate } from './templates';
import { buildFfmpegArgs } from './ffmpegArgs';

/** Ask the Rust side which FFmpeg it will use (so the UI can show it pre-render). */
export async function getFfmpegStatus(): Promise<FfmpegStatus> {
  try {
    return await invoke<FfmpegStatus>('ffmpeg_status');
  } catch {
    return { found: false, path: '', source: 'unknown' };
  }
}

// Production engine: builds FFmpeg args in shared TS, hands them to the thin Rust
// `run_ffmpeg` command (which resolves FFmpeg, dedupes the output path, and emits
// `render://log` events). All render logic lives in TS.
export const tauriRenderEngine: RenderEngine = {
  async render(job: RenderJob, onLog?: RenderLogFn): Promise<RenderResult> {
    const recipe = getRecipe(job.recipeId);
    if (!recipe) return { ok: false, error: `Unknown recipe "${job.recipeId}"` };
    const template = getTemplate(recipe.visualTemplateId);

    let fontPath: string | null = null;
    try {
      fontPath = await invoke<string | null>('font_path');
    } catch {
      fontPath = null; // title overlay is best-effort
    }

    const args = buildFfmpegArgs(job, recipe, template, { fontPath });
    const start = Date.now();

    let unlisten: (() => void) | undefined;
    if (onLog) {
      unlisten = await listen<string>('render://log', (event) => onLog(String(event.payload)));
    }

    try {
      const res = await invoke<{ outputPath: string; bytes: number }>('run_ffmpeg', { args });
      return { ok: true, outputPath: res.outputPath || job.outputPath, bytes: res.bytes, durationMs: Date.now() - start };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message, durationMs: Date.now() - start };
    } finally {
      unlisten?.();
    }
  },
};
