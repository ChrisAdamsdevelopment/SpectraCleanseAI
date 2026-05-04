# SpectraCleanse AI: Browser MP3 Cleanse Integration Plan

## 1) Objective
Integrate the standalone browser MP3 metadata cleanser into the existing client experience while preserving:
- auth/session behavior,
- Stripe upgrade flow,
- usage-limit enforcement,
- existing backend `/api/process` pathway,
- forensic report UX.

Primary UX goal: make the fast local path obvious for MP3 users, while keeping the full forensic server path available for all media types.

## 2) Product Strategy (Value-first)

### User value
1. **Speed:** MP3 users get immediate local cleanse with no upload required.
2. **Trust:** Local/offline-friendly flow reduces privacy concerns.
3. **Control:** Explicit two-step process (`Generate SEO` -> `Cleanse`) and manual download button.
4. **Coverage:** Non-MP3 and deep-clean use cases still routed through server pipeline.

### Business value
1. **Cost reduction:** offload many MP3 jobs from server/worker infra.
2. **Conversion lift:** clearer “Quick Browser Cleanse” vs “Full Server Cleanse” differentiation helps upsell.
3. **Retention:** faster time-to-success and lower friction for first job.

## 3) Architecture Decisions

### Keep
- New browser cleanse state machine and decoupled download flow.
- Dark themed tabbed UI (`Context`, `SEO Payload`, `Analysis`).
- Memory-safe object URL lifecycle.

### Replace/connect
- Replace mock SEO generator with authenticated `POST /api/generate-seo`.
- Keep `POST /api/process` as server cleanse fallback and premium/deep-clean path.
- Keep existing auth/session and usage handling around backend calls.

### Data flow
1. User uploads file.
2. Client parses metadata locally for analysis (including provenance indicators).
3. User clicks **Generate AI SEO Payload** -> call backend `/api/generate-seo`.
4. User chooses:
   - **Quick Cleanse (Browser)** for `.mp3` -> local ID3 write.
   - **Full Server Cleanse** for any supported format -> `/api/process`.
5. User clicks **Download Processed File** (no auto-download).

## 4) Implementation Plan (Phased)

### Phase 0 — Preflight alignment
- Confirm endpoint contracts for `/api/generate-seo` and `/api/process`.
- Confirm auth header behavior and 401/402 handling in client.
- Confirm if browser cleanse should count toward monthly usage (recommend: **no**, to maximize perceived value).

### Phase 1 — Dependencies + utility layer
- Add to client dependencies:
  - `browser-id3-writer`
  - `music-metadata-browser`
- Create `client/src/utils/metadata.ts` with:
  - `readFileMetadata(file)`
  - `writeMP3Metadata(file, metadata)`
  - provenance-risk helper (tag + filename marker scan)

### Phase 2 — App flow integration
- Replace legacy button logic with two-step sequence.
- Wire `generateSEO()` to `/api/generate-seo` (Bearer token).
- Implement `handleCleanse(useBrowser: boolean)` split path:
  - browser writer for MP3,
  - backend process for all formats.
- Ensure existing usage/plan upgrade behavior remains on server path.

### Phase 3 — UX polish
- Keep tabs and improve affordances:
  - Disable Quick Cleanse for non-MP3 with clear tooltip.
  - Empty states for SEO and analysis tabs.
  - Persist logs per session until file removed.
- Preserve forensic report UI and show when server path is used.

### Phase 4 — Hardening
- Blob URL revocation on replace/unmount.
- Error messaging consistency (`network`, `auth`, `quota`, `processing`).
- Add guardrails for malformed SEO payload response fields.

### Phase 5 — Release
- Feature flag optional (`VITE_ENABLE_BROWSER_MP3_CLEANSE=true`) for staged rollout.
- Release notes + in-app “What’s new” blurb.
- Capture metrics (see below) for 2-week validation.

## 5) UX Recommendations (Best presentation)

1. **Primary CTA hierarchy**
   - First: `Generate AI SEO Payload`
   - Second row: `Quick Cleanse (Browser)` and `Full Server Cleanse`
2. **Progressive disclosure**
   - Show short helper text under each cleanse mode explaining trade-offs.
3. **Analysis tab clarity**
   - Split into cards: file info, extracted tags, provenance risk, recommended action.
4. **Trust copy**
   - For browser path: “processed locally in your browser; nothing uploaded.”
5. **Download ergonomics**
   - Keep explicit button and filename prefix e.g. `SpectraCleanse_<original>`.

## 6) KPI / Success Metrics
Track these after launch:
- % of MP3 jobs using browser path.
- Median time from upload -> downloadable result.
- Server `/api/process` volume reduction for MP3 files.
- Free-to-paid conversion deltas after dual-path UI launch.
- Error rate by path (browser vs server).

## 7) QA Checklist

### Functional
- Login/signup/session restore/logout unchanged.
- `Generate SEO` calls backend and populates fields.
- Quick Cleanse enabled only for MP3.
- Full Server Cleanse works for MP3 + non-MP3.
- Download button works and never auto-downloads.

### Limits + billing
- 402 from server path opens upgrade modal.
- Stripe checkout flow unchanged.
- Usage counters update from server response headers.

### Technical
- Object URLs revoked on replacement and unmount.
- No memory leak after repeated upload/cleanse cycles.
- Provenance risk appears in analysis using parsed metadata.

## 8) Risks and Mitigations
- **Risk:** Browser ID3 writing misses edge tags.
  - **Mitigation:** Position Full Server Cleanse as deep-clean fallback.
- **Risk:** User confusion between two cleanse options.
  - **Mitigation:** concise mode descriptions + defaults by file type.
- **Risk:** Inconsistent SEO payload shape.
  - **Mitigation:** normalize response to safe defaults.

## 9) Suggested Ticket Breakdown
1. Client deps + metadata utility.
2. Replace mock SEO generation with backend call.
3. Cleanse bifurcation (browser vs server).
4. Analysis tab provenance/risk enhancements.
5. Download lifecycle and memory cleanup validation.
6. QA + telemetry instrumentation.

## 10) Rollout Recommendation
- Week 1: internal/beta users with feature flag on.
- Week 2: 50% rollout.
- Week 3: 100% rollout if KPIs and error budgets pass.
