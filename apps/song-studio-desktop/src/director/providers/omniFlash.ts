// Gemini Omni Flash adapter (DEC-003 §A) — the DEFAULT Google video provider.
//
// RE-VERIFIED against Google AI for Developers documentation on 2026-07-12
// (ai.google.dev/gemini-api/docs/interactions + /image-generation). CONFIRMED
// this pass:
//   • The Interactions API is real and Google's recommended path for the latest
//     models:  POST https://generativelanguage.googleapis.com/v1beta/interactions
//   • Auth header x-goog-api-key; multi-turn via `previous_interaction_id`;
//     long-running via `background: true`; an Interaction returns a chronological
//     list of execution `steps` ending in `model_output`; retrieve with
//     GET /v1beta/interactions/{id} (interactions.get).
//   • Media results arrive as content items (data | uri, mime_type) inside a
//     model_output step; large results are fetched via the returned uri.
// NOT fully pinned this pass (flagged honestly, NOT invented): the EXACT video
// model id string for interaction-based video. The image model id is confirmed
// as `gemini-3.1-flash-image`; the video model id here is CONFIGURABLE via
// opts.model and must be confirmed against the API reference before a live run —
// the code never hard-codes a provider id into business logic.
// Truthful capability facts: image/subject references supported; source-video
// editing supported (video input); AUDIO REFERENCE INPUTS UNSUPPORTED; no
// negative-prompt field (constraints folded into the prompt); no video
// extension (use Veo). Editing uploaded video is region-restricted (EEA/CH/UK) —
// surfaced by the API, never assumed here. No API key is persisted/logged/committed.
//
// IO (base64 encode, binary download) is host-injected via ProviderIo — no
// global monkey-patching. In the browser fallback these are absent and submit
// reports a clear blocked reason instead of pretending to work.

import type { VideoProviderAdapter, ProviderCapabilities, GenerationJobState, SubmitRequest, ProviderIo } from './types';

export const OMNI_MODEL = 'gemini-omni-flash-preview';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const omniFlashCapabilities: ProviderCapabilities = {
  textToVideo: true,
  imageToVideo: true,
  lastFrame: false,               // Veo specialty, not Omni
  referenceImages: 3,             // conservative documented subject-reference count
  humanLikenessReferences: true,  // subject references; person policy applies per region
  characterConsistency: true,
  videoExtension: false,          // unsupported for Omni (use Veo)
  sourceVideoEditing: true,       // edit an uploaded video (input 'document')
  conversationalEditing: true,    // previous_interaction_id
  audioInput: false,              // DOCUMENTED: audio reference inputs unsupported
  lipSync: false,                 // not promised; labeled honestly
  durationsSec: [],               // provider-inferred; not a fixed discrete set
  maxDurationSec: null,           // provider infers duration — no clamp, no block
  aspects: ['9:16', '16:9'],
  resolutions: ['720p', '1080p'],
  async: true,                    // inline for small results; URI + file polling for large
  costInfo: 'none',
  notes: 'Gemini Omni Flash via the Interactions API. Multimodal, conversational multi-turn editing, source-video editing. Audio conditioning and exact lip-sync are not offered — assemble to the song and use the lip-sync repair path.',
};

export function resolveGoogleKey(sessionKey?: string | null): string | null {
  if (sessionKey && sessionKey.trim()) return sessionKey.trim();
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.GOOGLE_API_KEY || env?.GEMINI_API_KEY || null;
}

export function createOmniFlashAdapter(opts: { sessionKey?: string | null; model?: string; io?: ProviderIo } = {}): VideoProviderAdapter {
  const model = opts.model || OMNI_MODEL;
  const keyFor = () => resolveGoogleKey(opts.sessionKey);
  const io = opts.io;

  return {
    id: 'google-omni',
    label: 'Gemini Omni Flash',
    model,
    capabilities: omniFlashCapabilities,
    isConfigured: () => Boolean(keyFor()),

    async submit(req: SubmitRequest): Promise<GenerationJobState> {
      const key = keyFor();
      if (!key) return { jobId: '', phase: 'failed', error: 'No Google API key configured.' };
      if (!io) return { jobId: '', phase: 'failed', error: 'Live generation needs the desktop app (file encoding is unavailable in the browser).' };
      try {
        // Omni has no negative-prompt field; fold constraints into the prompt.
        const promptText = req.negative ? `${req.prompt}\n\nConstraints: ${req.negative}` : req.prompt;
        const input: Array<Record<string, unknown>> = [];
        for (const p of req.referenceImagePaths.slice(0, 3)) {
          input.push({ type: 'image', data: await io.readBase64(p), mime_type: io.mimeType(p) });
        }
        if (req.sourceVideoPath) {
          // source-video editing: attach as a document/video input
          input.push({ type: 'video', data: await io.readBase64(req.sourceVideoPath), mime_type: 'video/mp4' });
        }
        input.push({ type: 'text', text: promptText });
        const body: Record<string, unknown> = {
          model,
          input,
          response_format: { type: 'video', aspect_ratio: req.aspect, delivery: 'uri' },
          background: true,   // long-running video: poll the interaction until completed
        };
        const task = req.sourceVideoPath ? 'edit' : req.referenceImagePaths.length > 0 ? 'reference_to_video' : 'text_to_video';
        body.generation_config = { video_config: { task } };
        if (req.parentInteractionId) body.previous_interaction_id = req.parentInteractionId;

        const res = await io.fetchJson(`${API_BASE}/interactions`, {
          method: 'POST', headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        });
        if (!res.ok) return { jobId: '', phase: 'failed', error: `submit failed: ${res.status} ${res.text}` };
        const json = res.json as { id?: string; status?: string; steps?: Array<{ type?: string; content?: Array<{ type?: string; uri?: string; data?: string }> }> };
        if (!json.id) return { jobId: '', phase: 'failed', error: 'submit returned no interaction id' };
        // Inline completion is possible for small results.
        const inline = extractVideo(json);
        if (json.status === 'completed' && inline) {
          return { jobId: json.id, phase: 'succeeded', resultUri: inline.uri, resultInlineBase64: inline.data, raw: json };
        }
        return { jobId: json.id, phase: 'submitted', raw: json };
      } catch (e) {
        return { jobId: '', phase: 'failed', error: e instanceof Error ? e.message : String(e) };
      }
    },

    async poll(jobId: string): Promise<GenerationJobState> {
      const key = keyFor();
      if (!key || !io) return { jobId, phase: 'failed', error: 'unavailable' };
      try {
        const res = await io.fetchJson(`${API_BASE}/interactions/${jobId}`, { headers: { 'x-goog-api-key': key } });
        if (!res.ok) return { jobId, phase: 'failed', error: `poll failed: ${res.status} ${res.text}` };
        const json = res.json as { status?: string; steps?: Array<{ type?: string; content?: Array<{ type?: string; uri?: string; data?: string }> }> };
        if (json.status && json.status !== 'completed') {
          return { jobId, phase: json.status === 'failed' ? 'failed' : 'running', raw: json };
        }
        const vid = extractVideo(json);
        if (!vid) return { jobId, phase: 'running', raw: json };
        return { jobId, phase: 'succeeded', resultUri: vid.uri, resultInlineBase64: vid.data, raw: json };
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

function extractVideo(json: { steps?: Array<{ type?: string; content?: Array<{ type?: string; uri?: string; data?: string }> }> }): { uri?: string; data?: string } | null {
  for (const step of json.steps ?? []) {
    if (step.type !== 'model_output') continue;
    for (const c of step.content ?? []) {
      if (c.type === 'video' && (c.uri || c.data)) return { uri: c.uri, data: c.data };
    }
  }
  return null;
}
