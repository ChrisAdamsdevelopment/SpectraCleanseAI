import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { RenderEngine, RenderJob, RenderResult, RenderLogFn } from './types';
import { getPreset } from './presets';
import { buildFfmpegArgs } from './ffmpegArgs';

// Production engine: builds the FFmpeg args in TypeScript (shared logic) and
// hands them to the thin Rust `run_ffmpeg` command, which executes FFmpeg and
// emits log lines on the `render://log` event channel.
export const tauriRenderEngine: RenderEngine = {
  async render(job: RenderJob, onLog?: RenderLogFn): Promise<RenderResult> {
    const preset = getPreset(job.presetId);
    if (!preset) return { ok: false, error: `Unknown preset "${job.presetId}"` };

    let fontPath: string | null = null;
    try {
      fontPath = await invoke<string | null>('font_path');
    } catch {
      fontPath = null; // title overlay is best-effort
    }

    const args = buildFfmpegArgs(job, preset, { fontPath });
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
