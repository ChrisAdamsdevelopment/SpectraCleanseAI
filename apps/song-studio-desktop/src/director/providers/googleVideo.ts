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

import type { VideoProviderAdapter, ProviderCapabilities, GenerationJobState, SubmitRequest } from './types';

export const GOOGLE_VIDEO_MODEL = 'veo-3.1-generate-preview';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const googleVideoCapabilities: ProviderCapabilities = {
  textToVideo: true,
  imageToVideo: true,
  lastFrame: true,
  referenceImages: 3,
  humanLikenessReferences: true, // subject to personGeneration policy/region
  characterConsistency: true,
  videoExtension: true,
  sourceVideoEditing: false,
  audioInput: false,             // Veo generates its own audio; not an input conditioner
  lipSync: false,
  durationsSec: [4, 6, 8],
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

async function fileToBase64(path: string): Promise<{ mimeType: string; data: string }> {
  // Tauri/browser-agnostic read via fetch on a file URL is not reliable across
  // platforms; the caller (App/Tauri) supplies a reader. In the Node test path
  // this function is not exercised (no live submit without a key).
  const readFileB64 = (globalThis as { __ssReadFileBase64?: (p: string) => Promise<string> }).__ssReadFileBase64;
  if (!readFileB64) throw new Error('no file reader configured for base64 encoding');
  const ext = (path.split('.').pop() || 'png').toLowerCase();
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  return { mimeType, data: await readFileB64(path) };
}

export function createGoogleVideoAdapter(opts: { sessionKey?: string | null; model?: string } = {}): VideoProviderAdapter {
  const model = opts.model || GOOGLE_VIDEO_MODEL;
  const keyFor = () => resolveGoogleKey(opts.sessionKey);

  return {
    id: 'google-video',
    label: 'Google video (Veo via Gemini API)',
    model,
    capabilities: googleVideoCapabilities,
    isConfigured: () => Boolean(keyFor()),

    async submit(req: SubmitRequest): Promise<GenerationJobState> {
      const key = keyFor();
      if (!key) return { jobId: '', phase: 'failed', error: 'No Google API key configured (set GOOGLE_API_KEY or enter a key in Settings).' };
      // 8s is required when reference images are attached.
      const durationSeconds = String(req.referenceImagePaths.length > 0 ? 8 : req.durationSec);
      const instance: Record<string, unknown> = { prompt: req.negative ? `${req.prompt}\n\nAvoid: ${req.negative}` : req.prompt };
      if (req.firstFramePath) instance.image = { inlineData: await fileToBase64(req.firstFramePath) };
      if (req.lastFramePath) instance.lastFrame = { inlineData: await fileToBase64(req.lastFramePath) };
      if (req.referenceImagePaths.length > 0) {
        instance.referenceImages = await Promise.all(req.referenceImagePaths.slice(0, 3).map(async (p) => ({ image: { inlineData: await fileToBase64(p) }, referenceType: 'asset' })));
      }
      const body = {
        instances: [instance],
        parameters: { aspectRatio: req.aspect, resolution: req.resolution, durationSeconds, personGeneration: 'allow_adult' },
      };
      try {
        const res = await fetch(`${API_BASE}/models/${model}:predictLongRunning`, {
          method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!res.ok) return { jobId: '', phase: 'failed', error: `submit failed: ${res.status} ${await res.text()}` };
        const json = await res.json() as { name?: string };
        if (!json.name) return { jobId: '', phase: 'failed', error: 'submit returned no operation name' };
        return { jobId: json.name, phase: 'submitted', raw: json };
      } catch (e) {
        return { jobId: '', phase: 'failed', error: e instanceof Error ? e.message : String(e) };
      }
    },

    async poll(jobId: string): Promise<GenerationJobState> {
      const key = keyFor();
      if (!key) return { jobId, phase: 'failed', error: 'No Google API key configured.' };
      try {
        const res = await fetch(`${API_BASE}/${jobId}`, { headers: { 'x-goog-api-key': key } });
        if (!res.ok) return { jobId, phase: 'failed', error: `poll failed: ${res.status} ${await res.text()}` };
        const json = await res.json() as { done?: boolean; error?: { message?: string }; response?: { generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> } } };
        if (!json.done) return { jobId, phase: 'running', raw: json };
        if (json.error) return { jobId, phase: 'failed', error: json.error.message || 'generation error', raw: json };
        const uri = json.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
        if (!uri) return { jobId, phase: 'failed', error: 'operation done but no video uri returned', raw: json };
        return { jobId, phase: 'succeeded', resultUri: uri, raw: json };
      } catch (e) {
        return { jobId, phase: 'failed', error: e instanceof Error ? e.message : String(e) };
      }
    },

    async download(resultUri: string, toPath: string): Promise<number> {
      const key = keyFor();
      if (!key) throw new Error('No Google API key configured.');
      const writeFile = (globalThis as { __ssDownloadToFile?: (uri: string, headers: Record<string, string>, toPath: string) => Promise<number> }).__ssDownloadToFile;
      if (!writeFile) throw new Error('no download writer configured (host must provide __ssDownloadToFile)');
      return writeFile(resultUri, { 'x-goog-api-key': key }, toPath);
    },
  };
}
