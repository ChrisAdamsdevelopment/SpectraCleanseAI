// Tauri implementation of DirectorHost. Real IO: file pickers, the fs plugin,
// run_ffmpeg (packet audio extraction + workprint assembly), and the Google
// video/text adapters (base64 refs + result download wired through globals the
// adapter reads). The API key is SESSION-ONLY (module variable) — never written
// to ReleaseProject, never committed, never logged.

import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { writeTextFile, readTextFile, mkdir, copyFile, readFile, writeFile, exists, stat } from '@tauri-apps/plugin-fs';
import type { DirectorHost, SubmitOutcome } from './hostIo';
import type { GenerationPacket, PacketFileDirective } from './compile';
import { writePacket as writePacketPure, resolveReturnAttemptId } from './packetIo';
import type { PacketFs } from './packetIo';
import { pickReferenceImage, pickGeneratedVideo, pickPacketExportDir } from '../project/storage';
import { createGoogleVideoAdapter } from './providers/googleVideo';

let sessionKey: string | null = null;
export function setGoogleApiKey(k: string | null) { sessionKey = k && k.trim() ? k.trim() : null; }
export function googleApiKeyPresent(): boolean {
  if (sessionKey) return true;
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return Boolean(env?.GOOGLE_API_KEY || env?.GEMINI_API_KEY);
}

async function toBase64(path: string): Promise<string> {
  const bytes = await readFile(path);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Wire the globals the Google adapter reads for base64 + download.
function installAdapterGlobals() {
  (globalThis as { __ssReadFileBase64?: (p: string) => Promise<string> }).__ssReadFileBase64 = toBase64;
  (globalThis as { __ssDownloadToFile?: (uri: string, headers: Record<string, string>, toPath: string) => Promise<number> }).__ssDownloadToFile =
    async (uri, headers, toPath) => {
      const res = await fetch(uri, { headers });
      if (!res.ok) throw new Error(`download failed: ${res.status}`);
      const buf = new Uint8Array(await res.arrayBuffer());
      await writeFile(toPath, buf);
      return buf.length;
    };
}

const tauriFs: PacketFs = {
  async mkdir(dir) { try { await mkdir(dir, { recursive: true }); } catch { /* exists */ } },
  async writeText(path, content) { await writeTextFile(path, content); },
  async copyFile(from, to) { await copyFile(from, to); },
  join: (...parts) => parts.join('/').replace(/\/+/g, '/'),
  async extractAudio(src, toWav, startSec, durationSec) {
    await invoke('run_ffmpeg', { args: ['-ss', String(startSec), '-i', src, '-t', String(durationSec), '-vn', '-ac', '2', '-ar', '44100', '-y', toWav] });
  },
  async readText(path) { return readTextFile(path); },
  async exists(path) { try { return await exists(path); } catch { return false; } },
  async statBytes(path) { try { return (await stat(path)).size ?? 0; } catch { return 0; } },
};

export function createTauriDirectorHost(opts: { outputDir: () => string | null }): DirectorHost {
  installAdapterGlobals();
  const adapter = () => createGoogleVideoAdapter({ sessionKey });

  return {
    pickReferenceImage: () => pickReferenceImage(),
    pickGeneratedVideo: () => pickGeneratedVideo(),
    pickPacketDir: () => pickPacketExportDir(),
    toSrc: (path) => { try { return path ? convertFileSrc(path) : null; } catch { return null; } },

    async writePacket(packet: GenerationPacket, destDir: string) { return writePacketPure(packet, destDir, tauriFs); },
    async writeFiles(files: PacketFileDirective[], destDir: string) {
      await tauriFs.mkdir(destDir);
      const written: string[] = [];
      for (const f of files) {
        const abs = tauriFs.join(destDir, f.relPath);
        const slash = f.relPath.lastIndexOf('/');
        if (slash > 0) await tauriFs.mkdir(tauriFs.join(destDir, f.relPath.slice(0, slash)));
        if (f.kind === 'text') await tauriFs.writeText(abs, f.content);
        else if (f.kind === 'copy') { if (await tauriFs.exists(f.sourcePath)) await tauriFs.copyFile(f.sourcePath, abs); }
        else if (f.kind === 'audio-segment') { if (await tauriFs.exists(f.audioPath)) await tauriFs.extractAudio(f.audioPath, abs, f.startSec, f.durationSec); }
        written.push(f.relPath);
      }
      return written;
    },
    async resolveReturnAttempt(mp4Path, guided) { return resolveReturnAttemptId(mp4Path, tauriFs, guided); },
    async fileBytes(path) { return tauriFs.statBytes(path); },

    providerConfigured: () => googleApiKeyPresent(),
    async submitGeneration(packet: GenerationPacket): Promise<SubmitOutcome> {
      if (!googleApiKeyPresent()) return { ok: false, blockedReason: 'No Google API key set (add one in Director settings, or use Export package).' };
      const a = adapter();
      const first = packet.references.find((r) => r.kind === 'first-frame')?.sourcePath;
      const last = packet.references.find((r) => r.kind === 'final-frame')?.sourcePath;
      const refPaths = packet.references.filter((r) => r.kind !== 'first-frame' && r.kind !== 'final-frame').map((r) => r.sourcePath).slice(0, 3);
      const out = await a.submit({
        prompt: packet.prompt, negative: packet.negative,
        aspect: packet.aspect, resolution: packet.resolution,
        durationSec: Math.min(8, Math.max(4, Math.round(packet.timing.durationSec))),
        referenceImagePaths: refPaths, firstFramePath: first, lastFramePath: last,
      });
      if (out.phase === 'failed') return { ok: false, error: out.error };
      return { ok: true, jobId: out.jobId };
    },
    async pollGeneration(jobId: string) {
      const a = adapter();
      const s = await a.poll(jobId);
      if (s.phase !== 'succeeded' || !s.resultUri) return { phase: s.phase, error: s.error };
      const dir = opts.outputDir() ?? '.';
      const toPath = `${dir}/generated_${Date.now().toString(36)}.mp4`;
      try { await a.download(s.resultUri, toPath); return { phase: 'succeeded', resultPath: toPath }; }
      catch (e) { return { phase: 'failed', error: e instanceof Error ? e.message : String(e) }; }
    },
    async runFfmpeg(args: string[]) {
      try { const res = await invoke<{ outputPath: string; bytes: number }>('run_ffmpeg', { args }); return res.bytes ?? 0; }
      catch { return 0; }
    },
  };
}

// ── Text-model tool generation (Gemini generateContent) ─────────────────────
import { toolGenerationPrompt, parseToolFromModelText, type ToolValidation } from './toolSchema';

export async function generateToolWithGemini(request: string, refinement?: string, previousJson?: string): Promise<ToolValidation & { rawPrompt: string }> {
  const rawPrompt = toolGenerationPrompt(request, refinement, previousJson);
  const key = sessionKey || (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GEMINI_API_KEY || (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.GOOGLE_API_KEY;
  if (!key) return { ok: false, tool: null, errors: ['no text-model key configured'], rawPrompt };
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
      method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: rawPrompt }] }] }),
    });
    if (!res.ok) return { ok: false, tool: null, errors: [`text model error ${res.status}`], rawPrompt };
    const json = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return { ...parseToolFromModelText(text), rawPrompt };
  } catch (e) {
    return { ok: false, tool: null, errors: [e instanceof Error ? e.message : String(e)], rawPrompt };
  }
}
