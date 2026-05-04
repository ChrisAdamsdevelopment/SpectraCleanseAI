# MP3 Browser-Cleanse Integration Plan (Value + UI/UX First)

## 1) Goal
Integrate the new browser-based MP3 metadata cleanse flow into the existing SpectraCleanse app while preserving:

- Auth/session flows
- Stripe upgrade paths and plan gating
- Usage tracking and free-tier limits
- Existing `/api/process` forensic backend pipeline

Primary product outcome:
- Deliver a fast, offline-friendly **Quick Cleanse (Browser)** path for MP3 files.
- Keep **Full Server Cleanse** for deep processing and all supported formats.

## 2) Product Strategy (Most Value First)

### User value hierarchy
1. **Speed and trust**: one-click browser MP3 cleanse that does not auto-download.
2. **Control**: explicit two-step flow (`Generate SEO` → `Cleanse`).
3. **Coverage**: preserve backend processing for non-MP3 and deeper forensic use cases.
4. **Transparency**: clear provenance-risk analysis and operation logs.

### Positioning in UI copy
- Browser path: "Fast, local MP3 cleanse (offline-friendly)"
- Server path: "Full forensic cleanse (all formats, server-powered)"

## 3) Target Architecture

### Frontend
- Add `browser-id3-writer` and `music-metadata-browser`.
- Introduce `src/utils/metadata.{ts|js}` for:
  - Metadata read and risk marker detection
  - MP3 ID3 rewrite
  - memory-safe blob URL lifecycle helpers
- Replace old cleanse trigger logic with new state machine:
  - `idle -> analyzing -> generating -> cleansing -> ready`

### Backend contracts
- Replace mock SEO generator with authenticated `POST /api/generate-seo`.
- Keep `POST /api/process` unchanged and available as fallback/deep path.
- Preserve 401 logout handling and 402 upgrade handling.

## 4) UX Flow Specification

## Flow A: Quick Cleanse (MP3)
1. Upload MP3.
2. Analyze metadata and display provenance risk markers.
3. Generate SEO from `/api/generate-seo`.
4. Cleanse locally via `browser-id3-writer`.
5. Show explicit **Download Processed File** button (no auto-download).

## Flow B: Full Server Cleanse (Any supported format)
1. Upload supported file.
2. Generate SEO from `/api/generate-seo`.
3. Submit to `/api/process` with current payload.
4. Handle usage headers and update UI usage meter.
5. Present download button and forensic report.

## Tabs
- **Context**: editable source info, prompt context, lyrics.
- **SEO Payload**: generated + user-editable title/description/tags/lyrics.
- **Analysis**: format, metadata, AI provenance risk, and cleanse readiness.

## 5) Implementation Plan (Phased)

### Phase 0 — Dependency + utility layer
- Install:
  - `browser-id3-writer@^4.4.0`
  - `music-metadata-browser@^2.5.11`
- Create metadata utility module and blob URL cleanup conventions.

### Phase 1 — Replace generation path
- Remove `mockGeminiGenerate` usage.
- Wire frontend generator button to authenticated `/api/generate-seo`.
- Normalize response into local `seoData` model.

### Phase 2 — Two-path cleanse execution
- MP3 + browser mode → local writer.
- Non-MP3 or selected server mode → `/api/process`.
- Keep one shared operation log panel and terminal-like status updates.

### Phase 3 — Analysis + risk enrichment
- Use parsed metadata to surface:
  - key tags (title/artist/genre/container)
  - marker hits (`c2pa`, `jumbf`, vendor strings like `suno`, `udio`, etc.)
- Add severity label with clear explanatory tooltip.

### Phase 4 — Hardening and rollout
- Regression test auth, usage gating, checkout, and logout.
- Add feature flag for staged release if desired:
  - `VITE_ENABLE_BROWSER_MP3_CLEANSE=true`

## 6) Technical Guardrails
- Never auto-download after processing.
- Revoke blob URLs on replace/unmount.
- Keep server cleanse endpoint and forensic report path intact.
- Ensure buttons are disabled for invalid states to prevent double-submit.
- Keep logs user-readable and timestamped.

## 7) Metrics to Validate Value

### Activation metrics
- % of users who reach "SEO generated"
- % of users who complete a cleanse after generating SEO

### Experience metrics
- Median time upload→download (Quick vs Server)
- Error rate by cleanse mode
- Retry rate per mode

### Business metrics
- Free-user upgrade conversion after 402 limit gate
- Creator/Studio retention impact after Quick Cleanse launch

## 8) Acceptance Criteria
- MP3 user can complete full local flow without backend `/api/process` call.
- Non-MP3 files continue to work via `/api/process`.
- Existing auth, usage checks, and checkout behavior remain unchanged.
- Analysis tab includes real metadata + provenance risk signal.
- Download remains manual, and memory cleanup passes QA.

## 9) Suggested Next Slice (Execution Order)
1. Add deps + utility module.
2. Wire `/api/generate-seo` and remove mock.
3. Implement browser MP3 cleanse path with manual download.
4. Preserve/verify server fallback path and usage headers.
5. Refine tab UX + provenance risk display.
