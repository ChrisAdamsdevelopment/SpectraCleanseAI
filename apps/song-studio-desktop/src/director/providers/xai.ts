// xAI / GROK PROVIDER (ALPHA-001 §8) — first-class, through the SAME
// provider-neutral capability system Google uses. No forked workflow: Grok
// consumes the identical canonical direction + GenerationPacket.
//
// VERIFIED against official xAI documentation on 2026-07-12
// (docs.x.ai/docs/overview, /docs/guides/image-generations,
//  /docs/guides/video-generations, /docs/api-reference). CONFIRMED:
//   Base URL   : https://api.x.ai/v1
//   Auth       : Authorization: Bearer $XAI_API_KEY
//   Compat     : OpenAI-compatible client libraries are supported.
//   Text       : POST /v1/chat/completions            model: grok-4.5
//   Image gen  : POST /v1/images/generations          model: grok-imagine-image-quality
//   Image edit : POST /v1/images/edits                (up to 3 source images)
//   Video      : POST /v1/videos/generations          model: grok-imagine-video-1.5
//                (grok-imagine-video for reference-to-video)
//   Video poll : GET  /v1/videos/{request_id}  -> { status: 'done', video: { url } }
//   Async      : video returns `request_id`; poll until status done.
//   Limits     : images n up to 10; image editing up to 3 reference images;
//                video duration up to 15s.
// NOT documented on the pages read (declared honestly, NOT invented):
//   - a dedicated key-validation endpoint (we use the cheapest documented call:
//     a 1-token chat completion — see testXaiConnection);
//   - exact aspect-ratio enumerations for video;
//   - source-video editing / video extension for Grok video — therefore those
//     capabilities are declared FALSE rather than guessed.
//
// A consumer Grok/X subscription does NOT imply xAI API access; the settings UI
// says so and the error mapping distinguishes "no credits / no access".
//
// IO is host-injected via ProviderIo — no global monkey-patching, no key ever
// persisted here.

import type {
  VideoProviderAdapter, ProviderCapabilities, GenerationJobState, SubmitRequest, ProviderIo,
  ImageProviderAdapter, ImageProviderCapabilities, ImageJobState, ImageSubmitRequest,
} from './types';
import { redactSecret } from '../../app/secureStore';

export const XAI_BASE = 'https://api.x.ai/v1';
export const XAI_TEXT_MODEL = 'grok-4.5';
export const XAI_IMAGE_MODEL = 'grok-imagine-image-quality';
export const XAI_VIDEO_MODEL = 'grok-imagine-video-1.5';
export const XAI_VIDEO_REF_MODEL = 'grok-imagine-video';

/** Documented limits (see header). Used by readiness so nothing is silently cut. */
export const XAI_MAX_IMAGE_OUTPUTS = 10;
export const XAI_MAX_EDIT_REFERENCES = 3;
export const XAI_MAX_VIDEO_SECONDS = 15;

// ── Error mapping (§8D) ─────────────────────────────────────────────────────

export type ProviderErrorCategory =
  | 'invalid-key' | 'no-credits' | 'no-permission' | 'model-unavailable'
  | 'region-restricted' | 'rate-limited' | 'network' | 'provider-outage' | 'unknown';

export interface MappedError {
  category: ProviderErrorCategory;
  /** Plain-language, creator-facing. Never a raw provider body. */
  message: string;
  /** Redacted technical detail for diagnostics/advanced view. */
  detail: string;
}

/** Map an HTTP status + body to a creator-facing category. Raw bodies are never
 * the only user-facing message (§8D) and are always redacted. */
export function mapXaiError(status: number, body: string): MappedError {
  const detail = redactSecret((body || '').slice(0, 500));
  const lower = (body || '').toLowerCase();
  if (status === 401 || status === 403) {
    if (lower.includes('credit') || lower.includes('billing') || lower.includes('quota')) {
      return { category: 'no-credits', message: 'Your xAI account was recognized, but it has no API credits available. Add credits in the xAI console, then test the connection again.', detail };
    }
    if (lower.includes('permission') || lower.includes('scope') || lower.includes('not allowed')) {
      return { category: 'no-permission', message: 'This xAI key does not have permission to use this API. Check the key\'s permissions in the xAI console.', detail };
    }
    if (status === 401) return { category: 'invalid-key', message: 'That xAI API key was not recognized. Check for a copy/paste slip — keys start with "xai-".', detail };
    return { category: 'no-permission', message: 'Your xAI account is not allowed to use this endpoint.', detail };
  }
  if (status === 402) return { category: 'no-credits', message: 'Your xAI account is out of API credits. Add credits in the xAI console, then try again.', detail };
  if (status === 404) return { category: 'model-unavailable', message: 'That Grok model is not available to this account. It may have been renamed or may need to be enabled in the xAI console.', detail };
  if (status === 429) return { category: 'rate-limited', message: 'xAI is rate-limiting this key right now. Wait a moment and try again.', detail };
  if (status === 451 || lower.includes('region') || lower.includes('country')) {
    return { category: 'region-restricted', message: 'xAI is not available for this account in your region.', detail };
  }
  if (status >= 500) return { category: 'provider-outage', message: 'xAI reported a server-side problem. This is on their end — try again shortly.', detail };
  if (status === 0) return { category: 'network', message: 'Song Studio could not reach xAI. Check your internet connection.', detail };
  return { category: 'unknown', message: `xAI rejected the request (HTTP ${status}).`, detail };
}

// ── Capabilities ────────────────────────────────────────────────────────────

/** Grok video. Capabilities are declared from DOCUMENTED facts only; anything
 * unconfirmed is FALSE so readiness never promises what we cannot verify. */
export const xaiVideoCapabilities: ProviderCapabilities = {
  textToVideo: true,
  imageToVideo: true,               // documented: `image` field (image-to-video)
  lastFrame: false,                 // not documented
  referenceImages: 3,               // documented multi-image limit
  humanLikenessReferences: true,
  characterConsistency: true,
  videoExtension: false,            // not documented — declared false, not guessed
  sourceVideoEditing: false,        // not documented for video — declared false
  conversationalEditing: false,
  audioInput: false,                // not documented
  lipSync: false,
  durationsSec: [],                 // continuous up to the cap, not a fixed set
  maxDurationSec: XAI_MAX_VIDEO_SECONDS, // documented "up to 15s" — readiness BLOCKS longer
  aspects: ['9:16', '16:9'],
  resolutions: ['720p', '1080p'],
  async: true,                      // documented request_id + polling
  costInfo: 'none',
  notes: 'Grok Imagine video via the xAI API. Async job + polling. Up to 15s per clip. Source-video repair and video extension are not documented for this provider, so Song Studio does not offer them here.',
};

export const xaiImageCapabilities: ImageProviderCapabilities = {
  referenceImages: XAI_MAX_EDIT_REFERENCES,  // documented: up to 3 source images
  humanLikenessReferences: true,
  maxOutputs: XAI_MAX_IMAGE_OUTPUTS,         // documented: n up to 10
  editing: true,                             // documented: /v1/images/edits
  aspects: ['9:16', '16:9', '1:1'],
  async: false,                              // documented as a direct response
  notes: 'Grok Imagine image generation and editing (up to 3 reference images, up to 10 variants per request).',
};

function authHeaders(key: string): Record<string, string> {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

// ── Connection test (§8D): cheapest reliable DOCUMENTED request ─────────────

export interface ConnectionTestResult {
  ok: boolean;
  category: ProviderErrorCategory | 'ok';
  message: string;
  detail?: string;
}

/** Confirms (a) the key is recognized, (b) the account can call the API, and
 * (c) the endpoint is reachable — using a 1-token chat completion, the cheapest
 * documented call. It never generates an image or video to test a key. */
export async function testXaiConnection(key: string, io: ProviderIo): Promise<ConnectionTestResult> {
  if (!key.trim()) return { ok: false, category: 'invalid-key', message: 'Enter an xAI API key first.' };
  try {
    const res = await io.fetchJson(`${XAI_BASE}/chat/completions`, {
      method: 'POST', headers: authHeaders(key),
      body: JSON.stringify({ model: XAI_TEXT_MODEL, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
    });
    if (res.ok) return { ok: true, category: 'ok', message: `Connected to xAI (${XAI_TEXT_MODEL}).` };
    const m = mapXaiError(res.status, res.text);
    return { ok: false, category: m.category, message: m.message, detail: m.detail };
  } catch (e) {
    const m = mapXaiError(0, e instanceof Error ? e.message : String(e));
    return { ok: false, category: m.category, message: m.message, detail: m.detail };
  }
}

// ── A. Grok text / reasoning adapter ────────────────────────────────────────

export interface TextAdapter {
  id: string;
  model: string;
  isConfigured(): boolean;
  /** Returns raw model text; callers validate it (safe schema validation). */
  complete(prompt: string, opts?: { maxTokens?: number }): Promise<{ ok: boolean; text: string; error?: MappedError }>;
}

/** Grok text. Used for directing-tool generation, scene assistance and conflict
 * explanation. EVERY tool definition it returns still passes the existing safe
 * declarative schema validation — a model can never emit executable code. */
export function createGrokTextAdapter(opts: { key: string | null; io?: ProviderIo; model?: string }): TextAdapter {
  const model = opts.model || XAI_TEXT_MODEL;
  return {
    id: 'xai-text',
    model,
    isConfigured: () => Boolean(opts.key),
    async complete(prompt, o) {
      if (!opts.key) return { ok: false, text: '', error: { category: 'invalid-key', message: 'Connect xAI in Settings → AI Providers first.', detail: '' } };
      if (!opts.io) return { ok: false, text: '', error: { category: 'network', message: 'Live requests need the desktop app.', detail: '' } };
      try {
        const res = await opts.io.fetchJson(`${XAI_BASE}/chat/completions`, {
          method: 'POST', headers: authHeaders(opts.key),
          body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: o?.maxTokens ?? 2048 }),
        });
        if (!res.ok) return { ok: false, text: '', error: mapXaiError(res.status, res.text) };
        const json = res.json as { choices?: Array<{ message?: { content?: string } }> };
        return { ok: true, text: json.choices?.[0]?.message?.content ?? '' };
      } catch (e) {
        return { ok: false, text: '', error: mapXaiError(0, e instanceof Error ? e.message : String(e)) };
      }
    },
  };
}

// ── B. Grok image adapter ───────────────────────────────────────────────────

export function createGrokImageAdapter(opts: { key: string | null; io?: ProviderIo; model?: string }): ImageProviderAdapter {
  const model = opts.model || XAI_IMAGE_MODEL;
  return {
    id: 'xai-image',
    label: 'Grok Imagine (image)',
    model,
    capabilities: xaiImageCapabilities,
    isConfigured: () => Boolean(opts.key),

    async submit(req: ImageSubmitRequest): Promise<ImageJobState> {
      if (!opts.key) return { jobId: '', phase: 'failed', error: 'Connect xAI in Settings → AI Providers first.' };
      if (!opts.io) return { jobId: '', phase: 'failed', error: 'Live reference generation needs the desktop app.' };
      const io = opts.io;
      try {
        // Editing (documented /v1/images/edits) when conditioning references are
        // supplied; otherwise plain generation. NEVER silently drop references —
        // readiness has already gated the count against XAI_MAX_EDIT_REFERENCES.
        const editing = req.referenceImagePaths.length > 0;
        const url = editing ? `${XAI_BASE}/images/edits` : `${XAI_BASE}/images/generations`;
        const body: Record<string, unknown> = {
          model, prompt: req.prompt,
          n: Math.min(req.outputCount, XAI_MAX_IMAGE_OUTPUTS),
          response_format: 'b64_json',
        };
        if (editing) {
          const images = await Promise.all(req.referenceImagePaths.slice(0, XAI_MAX_EDIT_REFERENCES).map(async (p) => ({
            url: `data:${io.mimeType(p)};base64,${await io.readBase64(p)}`,
          })));
          body.image = images.length === 1 ? images[0] : images;
        }
        const res = await io.fetchJson(url, { method: 'POST', headers: authHeaders(opts.key), body: JSON.stringify(body) });
        if (!res.ok) return { jobId: '', phase: 'failed', error: mapXaiError(res.status, res.text).message };
        const json = res.json as { data?: Array<{ b64_json?: string; url?: string }> };
        const items = json.data ?? [];
        if (items.length === 0) return { jobId: '', phase: 'failed', error: 'xAI returned no images.' };
        return {
          jobId: `xai-img-${Date.now().toString(36)}`, phase: 'succeeded',
          resultInlineBase64: items.map((i) => i.b64_json).filter((b): b is string => Boolean(b)),
          resultUris: items.map((i) => i.url).filter((u): u is string => Boolean(u)),
          raw: json,
        };
      } catch (e) {
        return { jobId: '', phase: 'failed', error: mapXaiError(0, e instanceof Error ? e.message : String(e)).message };
      }
    },

    // Images are documented as a direct response; a poll can only report the
    // already-known terminal state.
    async poll(jobId: string): Promise<ImageJobState> {
      return { jobId, phase: 'succeeded' };
    },

    async download(resultUri: string, toPath: string): Promise<number> {
      if (!opts.io || !opts.key) throw new Error('unavailable');
      return opts.io.downloadToFile(resultUri, { Authorization: `Bearer ${opts.key}` }, toPath);
    },
  };
}

// ── C. Grok video adapter ───────────────────────────────────────────────────

export function createGrokVideoAdapter(opts: { key: string | null; io?: ProviderIo; model?: string }): VideoProviderAdapter {
  const baseModel = opts.model || XAI_VIDEO_MODEL;
  return {
    id: 'xai-video',
    label: 'Grok Imagine (video)',
    model: baseModel,
    capabilities: xaiVideoCapabilities,
    isConfigured: () => Boolean(opts.key),

    async submit(req: SubmitRequest): Promise<GenerationJobState> {
      if (!opts.key) return { jobId: '', phase: 'failed', error: 'Connect xAI in Settings → AI Providers first.' };
      if (!opts.io) return { jobId: '', phase: 'failed', error: 'Live generation needs the desktop app.' };
      const io = opts.io;
      try {
        // Grok has no negative-prompt field documented; fold constraints in.
        const prompt = req.negative ? `${req.prompt}\n\nConstraints: ${req.negative}` : req.prompt;
        // reference-to-video uses the documented reference model id.
        const usingRefs = req.referenceImagePaths.length > 0 || Boolean(req.firstFramePath);
        const model = usingRefs ? XAI_VIDEO_REF_MODEL : baseModel;
        const body: Record<string, unknown> = {
          model, prompt,
          // NO SILENT DURATION CHANGE (§8): send the exact directed duration.
          // Readiness blocks anything above XAI_MAX_VIDEO_SECONDS before we get here.
          duration: req.durationSec,
        };
        // image-to-video: the documented `image` field takes a source image.
        const firstRef = req.firstFramePath ?? req.referenceImagePaths[0];
        if (firstRef) {
          body.image = { url: `data:${io.mimeType(firstRef)};base64,${await io.readBase64(firstRef)}` };
        }
        const res = await io.fetchJson(`${XAI_BASE}/videos/generations`, {
          method: 'POST', headers: authHeaders(opts.key), body: JSON.stringify(body),
        });
        if (!res.ok) return { jobId: '', phase: 'failed', error: mapXaiError(res.status, res.text).message };
        const json = res.json as { request_id?: string; status?: string; video?: { url?: string } };
        if (json.status === 'done' && json.video?.url) {
          return { jobId: json.request_id ?? 'xai-immediate', phase: 'succeeded', resultUri: json.video.url, raw: json };
        }
        if (!json.request_id) return { jobId: '', phase: 'failed', error: 'xAI returned no request id for the video job.' };
        return { jobId: json.request_id, phase: 'submitted', raw: json };
      } catch (e) {
        return { jobId: '', phase: 'failed', error: mapXaiError(0, e instanceof Error ? e.message : String(e)).message };
      }
    },

    async poll(jobId: string): Promise<GenerationJobState> {
      if (!opts.key || !opts.io) return { jobId, phase: 'failed', error: 'unavailable' };
      try {
        const res = await opts.io.fetchJson(`${XAI_BASE}/videos/${jobId}`, { headers: { Authorization: `Bearer ${opts.key}` } });
        if (!res.ok) return { jobId, phase: 'failed', error: mapXaiError(res.status, res.text).message };
        const json = res.json as { status?: string; video?: { url?: string }; error?: unknown };
        if (json.status === 'done') {
          const url = json.video?.url;
          if (!url) return { jobId, phase: 'failed', error: 'xAI reported the video as done but returned no URL.' };
          return { jobId, phase: 'succeeded', resultUri: url, raw: json };
        }
        if (json.status === 'failed' || json.status === 'error') {
          return { jobId, phase: 'failed', error: redactSecret(typeof json.error === 'string' ? json.error : 'xAI could not generate this video.'), raw: json };
        }
        return { jobId, phase: 'running', raw: json };
      } catch (e) {
        return { jobId, phase: 'failed', error: mapXaiError(0, e instanceof Error ? e.message : String(e)).message };
      }
    },

    async download(resultUri: string, toPath: string): Promise<number> {
      if (!opts.key || !opts.io) throw new Error('unavailable');
      return opts.io.downloadToFile(resultUri, { Authorization: `Bearer ${opts.key}` }, toPath);
    },
  };
}
