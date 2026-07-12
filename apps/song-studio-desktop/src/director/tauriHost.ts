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
import { createOmniFlashAdapter } from './providers/omniFlash';
import { createGeminiImageAdapter } from './providers/geminiImage';
import { PROVIDERS, DEFAULT_PROVIDER_ID, capabilitiesFor, IMAGE_PROVIDERS, DEFAULT_IMAGE_PROVIDER_ID, imageCapabilitiesFor } from './providers/registry';
import type { ProviderIo, VideoProviderAdapter } from './providers/types';

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

// Host-injected provider IO (no global monkey-patching, §A). Adapters call these.
const providerIo: ProviderIo = {
  readBase64: (p) => toBase64(p),
  mimeType: (p) => {
    const ext = (p.split('.').pop() || '').toLowerCase();
    return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'mp4' ? 'video/mp4' : 'image/png';
  },
  async fetchJson(url, init) {
    const res = await fetch(url, init);
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    return { ok: res.ok, status: res.status, text, json };
  },
  async downloadToFile(uri, headers, toPath) {
    const res = await fetch(uri, { headers });
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const buf = new Uint8Array(await res.arrayBuffer());
    await writeFile(toPath, buf);
    return buf.length;
  },
  async writeBase64ToFile(base64, toPath) {
    const bin = atob(base64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    await writeFile(toPath, buf);
    return buf.length;
  },
};

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
  let providerId = DEFAULT_PROVIDER_ID;
  let imageProviderId = DEFAULT_IMAGE_PROVIDER_ID;
  const adapterFor = (id: string): VideoProviderAdapter =>
    id === 'google-veo'
      ? createGoogleVideoAdapter({ sessionKey, io: providerIo })
      : createOmniFlashAdapter({ sessionKey, io: providerIo });
  const imageAdapterFor = () => createGeminiImageAdapter({ sessionKey, io: providerIo });

  return {
    canExportPackets: true,
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

    providers: () => PROVIDERS.filter((p) => p.role !== 'manual').map((p) => ({ id: p.id, label: p.label, role: p.role, bestFor: p.bestFor })),
    selectedProviderId: () => providerId,
    setProvider: (id: string) => { if (PROVIDERS.some((p) => p.id === id)) providerId = id; },
    providerCapabilities: () => capabilitiesFor(providerId),
    setApiKey: (k: string | null) => setGoogleApiKey(k),
    providerConfigured: () => googleApiKeyPresent(),
    async submitGeneration(packet: GenerationPacket, subOpts?: { sourceVideoPath?: string; parentInteractionId?: string }): Promise<SubmitOutcome> {
      if (!googleApiKeyPresent()) return { ok: false, blockedReason: 'No Google API key set (add one in Director settings, or use Export package).' };
      const a = adapterFor(providerId);
      const first = packet.references.find((r) => r.kind === 'first-frame')?.sourcePath;
      const last = packet.references.find((r) => r.kind === 'final-frame')?.sourcePath;
      const refPaths = packet.references.filter((r) => r.kind !== 'first-frame' && r.kind !== 'final-frame').map((r) => r.sourcePath);
      // NO CLAMP (§C): send the EXACT directed duration. Readiness has already
      // gated this against the provider's capabilities before submit.
      const out = await a.submit({
        prompt: packet.prompt, negative: packet.negative,
        aspect: packet.aspect, resolution: packet.resolution, durationSec: packet.timing.durationSec,
        referenceImagePaths: refPaths, firstFramePath: first, lastFramePath: last,
        sourceVideoPath: subOpts?.sourceVideoPath, parentInteractionId: subOpts?.parentInteractionId,
      });
      if (out.phase === 'failed') return { ok: false, error: out.error };
      return { ok: true, jobId: out.jobId };
    },
    async pollGeneration(jobId: string) {
      const a = adapterFor(providerId);
      const s = await a.poll(jobId);
      if (s.phase !== 'succeeded') return { phase: s.phase, error: s.error };
      const dir = opts.outputDir() ?? '.';
      const toPath = `${dir}/generated_${Date.now().toString(36)}.mp4`;
      try {
        if (s.resultInlineBase64) { await providerIo.writeBase64ToFile(s.resultInlineBase64, toPath); return { phase: 'succeeded', resultPath: toPath }; }
        if (s.resultUri) { await a.download(s.resultUri, toPath); return { phase: 'succeeded', resultPath: toPath }; }
        return { phase: 'failed', error: 'succeeded but no video payload' };
      } catch (e) { return { phase: 'failed', error: e instanceof Error ? e.message : String(e) }; }
    },
    imageProviders: () => IMAGE_PROVIDERS.filter((p) => p.role !== 'manual').map((p) => ({ id: p.id, label: p.label, role: p.role, bestFor: p.bestFor })),
    selectedImageProviderId: () => imageProviderId,
    setImageProvider: (id: string) => { if (IMAGE_PROVIDERS.some((p) => p.id === id)) imageProviderId = id; },
    imageProviderCapabilities: () => imageCapabilitiesFor(imageProviderId),
    async submitReferenceGeneration(prompt, conditioningPaths, outputCount, aspect): Promise<SubmitOutcome> {
      if (!googleApiKeyPresent()) return { ok: false, blockedReason: 'No Google API key set (add one in Director settings, or use the manual reference package).' };
      const a = imageAdapterFor();
      const out = await a.submit({ prompt, referenceImagePaths: conditioningPaths, outputCount, aspect });
      if (out.phase === 'failed') return { ok: false, error: out.error };
      // Whether it completed inline or is pending, the interaction is stored and
      // polling materializes the images (avoids orphaning inline writes here).
      return { ok: true, jobId: out.jobId };
    },
    async pollReferenceGeneration(jobId: string) {
      const a = imageAdapterFor();
      const s = await a.poll(jobId);
      if (s.phase !== 'succeeded') return { phase: s.phase, error: s.error };
      try {
        const paths = await materializeImages(s.resultInlineBase64, s.resultUris, a, opts.outputDir() ?? '.');
        return paths.length ? { phase: 'succeeded', resultPaths: paths } : { phase: 'failed', error: 'succeeded but no image payload' };
      } catch (e) { return { phase: 'failed', error: e instanceof Error ? e.message : String(e) }; }
    },
    async runFfmpeg(args: string[]) {
      try { const res = await invoke<{ outputPath: string; bytes: number }>('run_ffmpeg', { args }); return res.bytes ?? 0; }
      catch { return 0; }
    },
  };
}

/** Write inline base64 images / download image URIs to local PNG files. */
async function materializeImages(inline: string[] | undefined, uris: string[] | undefined, a: { download(uri: string, to: string): Promise<number> }, dir: string): Promise<string[]> {
  const out: string[] = [];
  let n = 0;
  for (const b64 of inline ?? []) {
    const to = `${dir}/ref_${Date.now().toString(36)}_${n++}.png`;
    await providerIo.writeBase64ToFile(b64, to); out.push(to);
  }
  for (const uri of uris ?? []) {
    const to = `${dir}/ref_${Date.now().toString(36)}_${n++}.png`;
    await a.download(uri, to); out.push(to);
  }
  return out;
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
