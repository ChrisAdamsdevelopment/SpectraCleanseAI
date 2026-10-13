// Google video provider adapter (DEC-003 §8) — Veo family via the Gemini API.
//
// VERIFIED against official Google AI for Developers documentation (ai.google.dev
// /gemini-api/docs/veo) at implementation time (2026-07):
//   Endpoint:  POST https://generativelanguage.googleapis.com/v1beta/models/
//              {model}:predictLongRunning
//   Auth:      header  x-goog-api-key: <API key>
//   Body:      { instances:[{ prompt, image?, lastFrame?, referenceImages?[] }],
//                parameters:{ aspectRatio, resolution, durationSeconds, personGeneration } }
//   Poll:      GET https://generativelanguage.googleapis.com/v1beta/{operationName}
//              → { done, response.generateVideoResponse.generatedSamples[].video.uri }
//   Download:  GET the video uri with the same x-goog-api-key header.
// Models: veo-3.1-generate-preview (+ fast/lite). Durations "4"|"6"|"8"
// (8 required for 1080p/4k or reference images). Aspects 16:9 | 9:16.
// referenceImages support up to 3 asset references; personGeneration governs
// human likeness (region-restricted). Model IDs may advance; the code refers to
// the Google video provider generically and the model id is configurable.
//
// The adapter reads its key from the environment (dev) or a caller-injected
// session value — NEVER from ReleaseProject, never committed, never logged.

import type { VideoProviderAdapter, ProviderCapabilities, GenerationJobState, SubmitRequest, ProviderIo } from './types';

export const GOOGLE_VIDEO_MODEL = 'veo-3.1-generate-preview';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const googleVideoCapabilities: ProviderCapabilities = {
  textToVideo: true,
  imageToVideo: true,
  lastFrame: true,
  referenceImages: 3,
  humanLikenessReferences: true, // subject to personGeneration policy/region
  characterConsistency: true,
  videoExtension: true,          // Veo's specialist strength: scene extension
  sourceVideoEditing: false,
  conversationalEditing: false,
  audioInput: false,             // Veo generates its own audio; not an input conditioner
  lipSync: false,
  durationsSec: [4, 6, 8],
  maxDurationSec: 8,             // hard cap — readiness BLOCKS longer scenes (never clamps)
  aspects: ['16:9', '9:16'],
  resolutions: ['720p', '1080p'],
  async: true,
  costInfo: 'none',              // no reliable per-request cost from the API; shown as "cost unknown"
  notes: 'Veo family via Gemini API. 8s required for 1080p or reference images. Human likeness governed by personGeneration and region policy.',
};

/** Resolve the API key without persisting it. Dev: env var. Prod: a session
 * value injected by the settings UI. */
export function resolveGoogleKey(sessionKey?: string | null): string | null {
  if (sessionKey && sessionKey.trim()) return sessionKey.trim();
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.GOOGLE_API_KEY || env?.GEMINI_API_KEY || null;
}

export function createGoogleVideoAdapter(opts: { sessionKey?: string | null; model?: string; io?: ProviderIo } = {}): VideoProviderAdapter {
  const model = opts.model || GOOGLE_VIDEO_MODEL;
  const keyFor = () => resolveGoogleKey(opts.sessionKey);
  const io = opts.io;

  return {
    id: 'google-veo',
    label: 'Google Veo',
    model,
    capabilities: googleVideoCapabilities,
    isConfigured: () => Boolean(keyFor()),

    async submit(req: SubmitRequest): Promise<GenerationJobState> {
      const key = keyFor();
      if (!key) return { jobId: '', phase: 'failed', error: 'No Google API key configured.' };
      if (!io) return { jobId: '', phase: 'failed', error: 'Live generation needs the desktop app.' };
      // No silent clamping (DEC-003 §C): send the EXACT requested duration.
      // Readiness gates duration against maxDurationSec (8) before we reach here.
      const durationSeconds = String(req.durationSec);
      const instance: Record<string, unknown> = { prompt: req.negative ? `${req.prompt}\n\nAvoid: ${req.negative}` : req.prompt };
      if (req.firstFramePath) instance.image = { inlineData: { mimeType: io.mimeType(req.firstFramePath), data: await io.readBase64(req.firstFramePath) } };
      if (req.lastFramePath) instance.lastFrame = { inlineData: { mimeType: io.mimeType(req.lastFramePath), data: await io.readBase64(req.lastFramePath) } };
      if (req.referenceImagePaths.length > 0) {
        instance.referenceImages = await Promise.all(req.referenceImagePaths.slice(0, 3).map(async (p) => ({ image: { inlineData: { mimeType: io.mimeType(p), data: await io.readBase64(p) } }, referenceType: 'asset' })));
      }
      const body = { instances: [instance], parameters: { aspectRatio: req.aspect, resolution: req.resolution, durationSeconds, personGeneration: 'allow_adult' } };
      const res = await io.fetchJson(`${API_BASE}/models/${model}:predictLongRunning`, { method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) return { jobId: '', phase: 'failed', error: `submit failed: ${res.status} ${res.text}` };
      const json = res.json as { name?: string };
      if (!json.name) return { jobId: '', phase: 'failed', error: 'submit returned no operation name' };
      return { jobId: json.name, phase: 'submitted', raw: json };
    },

    async poll(jobId: string): Promise<GenerationJobState> {
      const key = keyFor();
      if (!key || !io) return { jobId, phase: 'failed', error: 'unavailable' };
      const res = await io.fetchJson(`${API_BASE}/${jobId}`, { headers: { 'x-goog-api-key': key } });
      if (!res.ok) return { jobId, phase: 'failed', error: `poll failed: ${res.status} ${res.text}` };
      const json = res.json as { done?: boolean; error?: { message?: string }; response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } } };
      if (!json.done) return { jobId, phase: 'running', raw: json };
      if (json.error) return { jobId, phase: 'failed', error: json.error.message || 'generation error', raw: json };
      const uri = json.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
      if (!uri) return { jobId, phase: 'failed', error: 'operation done but no video uri returned', raw: json };
      return { jobId, phase: 'succeeded', resultUri: uri, raw: json };
    },

    async download(resultUri: string, toPath: string): Promise<number> {
      const key = keyFor();
      if (!key || !io) throw new Error('unavailable');
      return io.downloadToFile(resultUri, { 'x-goog-api-key': key }, toPath);
    },
  };
}
