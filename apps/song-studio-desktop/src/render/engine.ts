import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { RenderEngine, RenderJob, RenderResult, RenderLogFn, FfmpegStatus } from './types';
import type { TitleLayer } from './types';
import { getRecipe } from './recipes';
import { getTemplate } from './templates';
import { recipeToComposition, getLayer } from './composition';
import { buildFfmpegArgs } from './ffmpegArgs';
import { getFontFamily } from '../lib/fonts';

/** Ask the Rust side which FFmpeg it will use (so the UI can show it pre-render). */
export async function getFfmpegStatus(): Promise<FfmpegStatus> {
  try {
    return await invoke<FfmpegStatus>('ffmpeg_status');
  } catch {
    return { found: false, path: '', source: 'unknown' };
  }
}

// Production engine: builds FFmpeg args from the (edited) composition and hands
// them to the thin Rust `run_ffmpeg` command. All render logic lives in TS.
export const tauriRenderEngine: RenderEngine = {
  async render(job: RenderJob, onLog?: RenderLogFn): Promise<RenderResult> {
    const recipe = getRecipe(job.recipeId);
    if (!recipe) return { ok: false, error: `Unknown recipe "${job.recipeId}"` };
    const composition = job.composition ?? recipeToComposition(recipe, getTemplate(recipe.visualTemplateId), { title: job.title });

    // Resolve the chosen title font family (first existing candidate); fall back
    // to any available system font.
    let fontPath: string | null = null;
    const titleLayer = getLayer<TitleLayer>(composition, 'title_text');
    if (titleLayer) {
      try { fontPath = await invoke<string | null>('resolve_font', { candidates: getFontFamily(titleLayer.font).files }); } catch { fontPath = null; }
    }
    if (!fontPath) {
      try { fontPath = await invoke<string | null>('font_path'); } catch { fontPath = null; }
    }

    const args = buildFfmpegArgs(composition, {
      imagePath: job.imagePath,
      audioPath: job.audioPath,
      outputPath: job.outputPath,
      durationSec: job.durationSec ?? recipe.defaultDurationSec,
      audioStartSec: job.audioStartSec,
    }, { fontPath });

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
