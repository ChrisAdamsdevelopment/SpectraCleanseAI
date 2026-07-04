# ADR: Canvas Loop Provider Architecture

- Status: Proposed
- Date: 2026-06-27
- Scope: Song Studio Desktop planning docs only

## Context

Song Studio Desktop needs a Canvas Loop Engine that can turn a user-uploaded short video into a vertical promotional loop. The creator selects an anchor frame, and the app helps find or create a segment whose ending returns smoothly to that anchor.

The immediate product need is a local-first MVP. Future premium versions may use AI video providers such as Gemini/Veo, Runway, or local models to repair seams, extend clips, or synthesize first-to-last-frame loop footage.

## Decision

Use a local-first pipeline with an optional provider-based AI layer.

Do not hardcode Gemini/Veo into the core engine. The core engine owns local analysis, scoring, preview, export, and reporting. AI providers are optional adapters behind a stable interface.

## Core modules

- `CanvasLoopEngine`: orchestrates validation, anchor handling, candidate search, scoring, export, and reporting.
- `VideoSpecValidator`: verifies file readability, duration, dimensions, FPS, orientation, and export suitability.
- `FrameExtractor`: extracts anchor, candidate, preview, and scoring frames through FFmpeg.
- `AnchorSelector`: stores and normalizes creator-selected anchor time/frame metadata.
- `LoopCandidateFinder`: searches candidate end frames and loop windows.
- `LoopScorer`: scores anchor/end similarity and motion continuity.
- `LocalLoopExporter`: exports direct, crossfade, and ping-pong MP4 loops.
- `LocalLoopRepairTools`: future CPU-safe repair helpers such as micro-crossfades, stabilized crops, or seam masks.
- `ReportGenerator`: writes test-lab and debugging reports.
- `AIProviderInterface`: provider-neutral contract for future remote or local AI repair.
- `GeminiVeoProvider`: optional adapter for Veo model IDs and request/response handling.

## Provider interface rule

The core engine should ask for capabilities, not model names. For example:

- `supportsPortrait916`
- `supportsFirstFrame`
- `supportsLastFrame`
- `supportsSameAnchorFirstLast`
- `supportsExtension`
- `supportedDurations`
- `supportedResolutions`
- `estimatedCost`
- `provenanceRequirements`

The `GeminiVeoProvider` may translate these into Veo-specific model IDs, request shapes, polling, file download, cost reporting, and provenance metadata.

## Consequences

### Benefits

- Local MVP remains useful without network, GPU, credentials, or paid APIs.
- Provider churn does not destabilize local loop creation.
- Future providers can be added without rewriting search, scoring, export, and reports.
- AI outputs can be evaluated against the same human and numeric test plan.

### Tradeoffs

- More architecture work than a one-off Veo integration.
- Provider capability negotiation must be maintained as APIs change.
- AI repair may produce output with different FPS, resolution, audio, watermarks, or provenance metadata than local exports.

## Non-goals

- Implementing Gemini/Veo calls in this planning pass.
- Making real paid API calls.
- Changing production render behavior.
- Replacing FFmpeg local export with a cloud-only workflow.

## Open decisions

- Exact TypeScript interface shape for `AIProviderInterface`.
- Whether AI repair returns full replacement clips, seam patches, extension clips, or all three.
- How user consent and disclosure should work before uploading media to a provider.
- Whether provider outputs should always be transcoded locally before final export.
