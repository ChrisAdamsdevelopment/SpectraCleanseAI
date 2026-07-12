// Gemini image-generation adapter (VIDEO-003B §1) — reference-variant proposals.
//
// VERIFIED against Google AI for Developers documentation at implementation time
// (2026-07-12, ai.google.dev/gemini-api/docs/image-generation +
// /gemini-api/docs/interactions). Confirmed facts:
//   Model:    gemini-3.1-flash-image  (native image-out generalist; -lite / 3-pro-image variants exist)
//   Endpoint: POST https://generativelanguage.googleapis.com/v1beta/interactions
//   Auth:     header  x-goog-api-key: <API key>
//   Body:     { model, input: Array<{type:'text'|'image', text?|data?|mime_type?}>,
//               response_format:{ type:'image', delivery:'base64'|'uri' },
//               background?: boolean }              // long-running when true
//   Poll:     GET /v1beta/interactions/{id}  → { status, steps:[{type:'model_output',
//               content:[{type:'image', data?|uri?, mime_type}]}] }
// The exact image model id is CONFIGURABLE — Google advances these regularly; the
// code never hard-codes a stale id in logic. IO is host-injected (ProviderIo) —
// no global monkey-patching. In the browser fallback io is absent and submit
// reports a clear blocked reason instead of pretending to work. No API key is
// ever persisted, logged, or committed.

import type { ImageProviderAdapter, ImageProviderCapabilities, ImageJobState, ImageSubmitRequest, ProviderIo } from './types';

export const GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const geminiImageCapabilities: ImageProviderCapabilities = {
  referenceImages: 3,
  humanLikenessReferences: true,   // subject-guided; person policy applies per region
  maxOutputs: 4,
  editing: true,
  aspects: ['9:16', '16:9', '1:1'],
  async: true,                     // inline for small; interaction polling otherwise
  notes: 'Gemini native image generation via the Interactions API. Produces reference proposals — never canonical until you approve them.',
};

export function resolveGoogleKey(sessionKey?: string | null): string | null {
  if (sessionKey && sessionKey.trim()) return sessionKey.trim();
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.GOOGLE_API_KEY || env?.GEMINI_API_KEY || null;
}

export function createGeminiImageAdapter(opts: { sessionKey?: string | null; model?: string; io?: ProviderIo } = {}): ImageProviderAdapter {
  const model = opts.model || GEMINI_IMAGE_MODEL;
  const keyFor = () => resolveGoogleKey(opts.sessionKey);
  const io = opts.io;

  return {
    id: 'gemini-image',
    label: 'Gemini image',
    model,
    capabilities: geminiImageCapabilities,
    isConfigured: () => Boolean(keyFor()),

    async submit(req: ImageSubmitRequest): Promise<ImageJobState> {
      const key = keyFor();
      if (!key) return { jobId: '', phase: 'failed', error: 'No Google API key configured.' };
      if (!io) return { jobId: '', phase: 'failed', error: 'Live reference generation needs the desktop app (image encoding is unavailable in the browser).' };
      try {
        const input: Array<Record<string, unknown>> = [];
        for (const p of req.referenceImagePaths.slice(0, geminiImageCapabilities.referenceImages)) {
          input.push({ type: 'image', data: await io.readBase64(p), mime_type: io.mimeType(p) });
        }
        input.push({ type: 'text', text: req.prompt });
        const body: Record<string, unknown> = {
          model, input,
          response_format: { type: 'image', aspect_ratio: req.aspect, delivery: 'base64' },
        };
        const res = await io.fetchJson(`${API_BASE}/interactions`, {
          method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!res.ok) return { jobId: '', phase: 'failed', error: `submit failed: ${res.status} ${res.text}` };
        const json = res.json as InteractionJson;
        if (!json.id) return { jobId: '', phase: 'failed', error: 'submit returned no interaction id' };
        const imgs = extractImages(json);
        if (json.status === 'completed' && imgs.length > 0) {
          return { jobId: json.id, phase: 'succeeded', resultInlineBase64: imgs.map((i) => i.data).filter((d): d is string => Boolean(d)), resultUris: imgs.map((i) => i.uri).filter((u): u is string => Boolean(u)), raw: json };
        }
        return { jobId: json.id, phase: 'submitted', raw: json };
      } catch (e) {
        return { jobId: '', phase: 'failed', error: e instanceof Error ? e.message : String(e) };
      }
    },

    async poll(jobId: string): Promise<ImageJobState> {
      const key = keyFor();
      if (!key || !io) return { jobId, phase: 'failed', error: 'unavailable' };
      try {
        const res = await io.fetchJson(`${API_BASE}/interactions/${jobId}`, { headers: { 'x-goog-api-key': key } });
        if (!res.ok) return { jobId, phase: 'failed', error: `poll failed: ${res.status} ${res.text}` };
        const json = res.json as InteractionJson;
        if (json.status && json.status !== 'completed') return { jobId, phase: json.status === 'failed' ? 'failed' : 'running', raw: json };
        const imgs = extractImages(json);
        if (imgs.length === 0) return { jobId, phase: 'running', raw: json };
        return { jobId, phase: 'succeeded', resultInlineBase64: imgs.map((i) => i.data).filter((d): d is string => Boolean(d)), resultUris: imgs.map((i) => i.uri).filter((u): u is string => Boolean(u)), raw: json };
      } catch (e) {
        return { jobId, phase: 'failed', error: e instanceof Error ? e.message : String(e) };
      }
    },

    async download(resultUri: string, toPath: string): Promise<number> {
      const key = keyFor();
      if (!key || !io) throw new Error('unavailable');
      return io.downloadToFile(resultUri, { 'x-goog-api-key': key }, toPath);
    },
  };
}

interface InteractionJson { id?: string; status?: string; steps?: Array<{ type?: string; content?: Array<{ type?: string; uri?: string; data?: string }> }> }

function extractImages(json: InteractionJson): Array<{ uri?: string; data?: string }> {
  const out: Array<{ uri?: string; data?: string }> = [];
  for (const step of json.steps ?? []) {
    if (step.type !== 'model_output') continue;
    for (const c of step.content ?? []) {
      if (c.type === 'image' && (c.uri || c.data)) out.push({ uri: c.uri, data: c.data });
    }
  }
  return out;
}
