// AI reference-variant generation (VIDEO-003B §1). Pure logic: build the image
// prompt, assess readiness against an image provider's truthful capabilities,
// persist request lifecycle, and turn results into UNAPPROVED proposals whose
// approval flows through the canonical entity apply transaction (bumping version
// + fingerprint, preserving prior takes). No IO here — the host encodes/writes.

import {
  makeReference, type DirectorState, type DirectorEntity, type ReferenceRequest,
  type ReferenceVariant, type ReferenceOrigin,
} from './model';
import { slug, type PacketFileDirective } from './compile';
import type { ImageProviderCapabilities } from './providers/types';
import { applyEntityIdentity } from './actions';

export interface ImageReadinessItem { id: string; severity: 'warning' | 'blocking'; message: string; resolutions: string[] }
export interface ImageReadinessResult { items: ImageReadinessItem[]; blocking: ImageReadinessItem[] }

/** Build the reference-generation prompt from the request + entity identity. */
export function buildReferencePrompt(entity: DirectorEntity, request: ReferenceRequest): string {
  const kindPhrase: Record<string, string> = {
    face: 'a clear frontal face portrait', profile: 'a side-profile portrait', hair: 'a clear view of the hairstyle',
    'full-body': 'a full-body view', 'tattoo-close': 'a close-up of the tattoo', 'tattoo-location': 'a view showing where the tattoo sits on the body',
    wardrobe: 'a clear view of the wardrobe/outfit', jewelry: 'a close view of the jewelry', prop: 'a clear view of the prop/object',
    architecture: 'a view of the building/architecture', material: 'a close view of the material/surface', lighting: 'a lighting reference',
    'first-frame': 'the first frame of a shot', 'final-frame': 'the final frame of a shot', style: 'a style-family reference', general: 'a reference image',
    pose: 'a pose reference', movement: 'a movement reference', camera: 'a camera/framing reference',
  };
  return [
    `Generate ${kindPhrase[request.kind] ?? 'a reference image'} of ${entity.name}${entity.description ? ` — ${entity.description}` : ''}.`,
    request.direction && `Direction: ${request.direction}`,
    request.bodyLocation && `Body location: ${request.bodyLocation}.`,
    request.traitsRemain.length > 0 && `MUST REMAIN TRUE (identity — do not change): ${request.traitsRemain.join('; ')}.`,
    request.traitsVary.length > 0 && `MAY VARY: ${request.traitsVary.join('; ')}.`,
    request.conditioningReferenceIds.length > 0 && 'Use the attached approved reference images as the identity to preserve.',
    'Produce a clean, well-lit reference on a plain background. No captions or watermarks.',
  ].filter(Boolean).join('\n');
}

/** Assess an image request against provider capabilities — never silently drop
 * a conditioning reference or overshoot the output count. */
export function assessImageReadiness(request: ReferenceRequest, caps: ImageProviderCapabilities): ImageReadinessResult {
  const items: ImageReadinessItem[] = [];
  if (request.conditioningReferenceIds.length > caps.referenceImages) {
    items.push({ id: 'too-many-conditioning', severity: 'blocking',
      message: `You selected ${request.conditioningReferenceIds.length} conditioning references, but this image provider accepts at most ${caps.referenceImages}.`,
      resolutions: [`Choose ${caps.referenceImages} conditioning references`, 'Switch to the manual reference package (no limit)'] });
  }
  if (request.outputCount > caps.maxOutputs) {
    items.push({ id: 'too-many-outputs', severity: 'warning',
      message: `Requested ${request.outputCount} variants; the provider returns at most ${caps.maxOutputs} per request.`,
      resolutions: [`Request ${caps.maxOutputs} or fewer`, 'Run the request again for more variants'] });
  }
  const blocking = items.filter((i) => i.severity === 'blocking');
  return { items, blocking };
}

export function setReferenceRequest(state: DirectorState, request: ReferenceRequest): DirectorState {
  const exists = state.referenceRequests.some((r) => r.id === request.id);
  return { ...state, referenceRequests: exists ? state.referenceRequests.map((r) => (r.id === request.id ? request : r)) : [...state.referenceRequests, request] };
}

/** Persist a submission: keep the interaction id so a pending image job resumes. */
export function applyReferenceSubmit(state: DirectorState, requestId: string, args: { providerId: string; modelId: string | null; jobId: string | null; phase: 'submitted' | 'running' | 'succeeded' | 'failed'; error?: string | null }): DirectorState {
  const req = state.referenceRequests.find((r) => r.id === requestId);
  if (!req) return state;
  const status: ReferenceRequest['status'] = args.phase === 'failed' ? 'failed' : args.phase === 'succeeded' ? 'succeeded' : args.phase === 'running' ? 'running' : 'submitted';
  return setReferenceRequest(state, { ...req, providerId: args.providerId, modelId: args.modelId, jobId: args.jobId, status, error: args.error ?? null });
}

export function applyReferencePoll(state: DirectorState, requestId: string, poll: { phase: string; error?: string }): DirectorState {
  const req = state.referenceRequests.find((r) => r.id === requestId);
  if (!req) return state;
  const status: ReferenceRequest['status'] = poll.phase === 'succeeded' ? 'succeeded' : poll.phase === 'failed' ? 'failed' : 'running';
  return setReferenceRequest(state, { ...req, status, error: poll.error ?? req.error });
}

/** Reference-variant requests with a pending image job resumable after reopen. */
export function resumableReferenceRequests(state: DirectorState): ReferenceRequest[] {
  return state.referenceRequests.filter((r) => r.jobId && (r.status === 'submitted' || r.status === 'running'));
}

/** Register one generated/imported result as an UNAPPROVED proposal on its
 * entity, tagged with generation provenance and linked back to its request. */
export function addProposedVariant(state: DirectorState, requestId: string, path: string, opts: { origin: ReferenceOrigin; label?: string } = { origin: 'ai-generated' }): { state: DirectorState; refId: string } {
  const req = state.referenceRequests.find((r) => r.id === requestId);
  const entity = req ? state.entities.find((e) => e.id === req.entityId) : undefined;
  if (!req || !entity) return { state, refId: '' };
  const ref: ReferenceVariant = makeReference(entity.id, req.kind, path, opts.label ?? `${req.kind} variant`, opts.origin, { generationAttemptId: req.id, note: req.direction || undefined });
  ref.approved = false;               // NEVER silently canonical
  ref.bodyLocation = req.bodyLocation;
  const nextEntity: DirectorEntity = { ...entity, references: [...entity.references, ref] };
  const s1: DirectorState = { ...state, entities: state.entities.map((e) => (e.id === entity.id ? nextEntity : e)) };
  const s2 = setReferenceRequest(s1, { ...req, status: req.status === 'exported' ? 'imported' : req.status, resultRefIds: [...req.resultRefIds, ref.id] });
  return { state: s2, refId: ref.id };
}

/** Approve a proposed variant THROUGH the canonical apply transaction so the
 * identity version + fingerprint advance once and prior takes are preserved. */
export function approveProposedVariant(state: DirectorState, entityId: string, refId: string): DirectorState {
  const entity = state.entities.find((e) => e.id === entityId);
  if (!entity) return state;
  const references = entity.references.map((r) => (r.id === refId ? { ...r, approved: true } : r));
  return applyEntityIdentity(state, entityId, { references });
}

export function rejectProposedVariant(state: DirectorState, entityId: string, refId: string): DirectorState {
  const entity = state.entities.find((e) => e.id === entityId);
  if (!entity) return state;
  // Rejecting an UNAPPROVED proposal never changes identity (no version bump).
  const references = entity.references.filter((r) => r.id !== refId);
  return { ...state, entities: state.entities.map((e) => (e.id === entityId ? { ...e, references } : e)) };
}

/** Manual reference-generation package (§1) — end-to-end without credentials. */
export function compileReferencePackage(state: DirectorState, request: ReferenceRequest): { files: PacketFileDirective[]; prompt: string } {
  const entity = state.entities.find((e) => e.id === request.entityId);
  if (!entity) return { files: [], prompt: '' };
  const prompt = buildReferencePrompt(entity, request);
  const seen = new Set<string>();
  const condRefs = request.conditioningReferenceIds
    .map((id) => entity.references.find((r) => r.id === id && r.approved))
    .filter((r): r is ReferenceVariant => Boolean(r));
  const files: PacketFileDirective[] = [
    { kind: 'text', relPath: 'README.md', content: `# Reference-variant request — ${entity.name} (${request.kind})\nGenerate the image described in prompt.md using the identity images in conditioning/. Return the result and import it in Song Studio → Visual Library → this request. It arrives as an UNAPPROVED proposal until you approve it.` },
    { kind: 'text', relPath: 'prompt.md', content: prompt },
    { kind: 'text', relPath: 'request.json', content: JSON.stringify({ requestId: request.id, entityId: entity.id, entityVersion: request.entityVersion, kind: request.kind, direction: request.direction, traitsRemain: request.traitsRemain, traitsVary: request.traitsVary, outputCount: request.outputCount }, null, 2) },
    { kind: 'text', relPath: 'return-contract.json', content: JSON.stringify({ requestId: request.id, expected: `${request.outputCount} reference image(s)`, howToReturn: `Import the image for reference request ${request.id} in the Visual Library.` }, null, 2) },
  ];
  condRefs.forEach((r, i) => {
    const ext = (r.path.split('.').pop() || 'png').toLowerCase();
    let name = `conditioning/${slug(entity.name)}_${slug(r.kind)}.${ext}`;
    while (seen.has(name)) { name = `conditioning/${slug(entity.name)}_${slug(r.kind)}_${i}.${ext}`; }
    seen.add(name);
    files.push({ kind: 'copy', relPath: name, sourcePath: r.path });
  });
  return { files, prompt };
}
