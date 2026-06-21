# Architecture Spike: Song-Centered Artist Content Studio

## Current repo observations

Static inspection shows the repository is currently a web application with documentation and release-readiness/deployment notes. The root README describes a product centered on metadata cleansing, Gemini-assisted metadata generation, authentication, billing, upload processing, a SQLite-backed backend, Docker production deployment, Render readiness, and rate limiting.

The only existing file under `docs/` at the time of this spike is `docs/manual-qa-checklist.md`, which supports manual QA for local, API, auth, billing, upload, cleanse, Docker, and production-readiness flows.

## What can be reused

The pivot should reuse current foundations where possible:

- Existing web app shell and deployment path.
- Authentication and account/session flows.
- Billing/subscription gates if paid content-studio limits are later defined.
- Upload handling for audio/video files where compatible with song import.
- Existing SQLite/local database approach for early song projects, drafts, and campaign records.
- Existing metadata/readiness capabilities as a supporting module attached to imported songs or assets.
- Existing Render/Docker deployment documentation and operational checks.
- Existing AI generation integration patterns, provided prompts and outputs stay truthful and reviewable.

## What should remain web-based

The initial Song-Centered Artist Content Studio should remain web-based for:

- Song project creation and editing.
- Lyrics, hooks, mood, genre, audience, and release-context capture.
- Content briefs and generated text drafts.
- Copy/export of captions, announcements, post drafts, and clip scripts.
- Campaign organization and lightweight planning.
- Release-readiness reports and metadata review.
- Account, billing, and deployment continuity.

A web-first path minimizes product risk and avoids prematurely rebuilding the app around native rendering.

## What may need desktop/Tauri later

Desktop/Tauri may become useful if the product requires heavy local media processing that is expensive, slow, or operationally fragile on hosted infrastructure.

Potential future desktop reasons:

- Local FFmpeg rendering of many high-resolution clips.
- Direct filesystem access to large audio/video asset libraries.
- Offline project editing.
- Reduced server storage and compute costs.
- User-controlled exports without uploading large source files.

This should remain a later decision. The MVP can validate the song-centered workflow without desktop distribution.

## Recommended architecture

Use an additive modular architecture:

```text
Web UI
  Song Studio workspace
  Existing release-readiness screens/module

API layer
  Songs
  Song assets
  Content briefs
  Content drafts
  Campaigns
  Existing cleanse/readiness endpoints

Domain services
  Song project service
  Content generation service
  Release-readiness adapter
  Future render orchestration service

Persistence
  Existing SQLite/local database pattern for MVP
  File/object storage for uploads and future renders

Rendering layer (future)
  Remotion composition templates
  FFmpeg transcode/export steps
  Queue/worker isolation
```

Key principle: release-readiness becomes an attachable capability, not the removed old product.

## Proposed repo/package structure

Exact placement should follow the existing codebase conventions, but the target separation should be:

```text
src/ or app/
  song-studio/
    components/
    pages-or-routes/
    hooks/
    types/
  release-readiness/
    existing or adapted readiness UI
  shared/
    api/
    auth/
    billing/
    ui/

server/ or api/
  routes/
    songs
    song-assets
    content-drafts
    campaigns
  services/
    song-project-service
    content-generation-service
    release-readiness-service
    render-orchestration-service (future)
  db/
    migrations or schema definitions

rendering/ (future)
  remotion/
    compositions/
    templates/
  ffmpeg/
    presets/
```

If the actual repository uses different top-level folders, preserve those conventions rather than forcing this exact layout.

## Remotion/FFmpeg feasibility

Remotion and FFmpeg are feasible for future video generation, but they should not be presented as active product capabilities until implemented.

Feasibility notes:

- Remotion can define reusable React-based video compositions for lyric clips, visualizers, canvases, and short-form variants.
- FFmpeg can transcode, mux, trim, normalize, and package exported media.
- Rendering should run outside normal request/response paths because video generation can be CPU- and memory-intensive.
- A worker/queue model is likely required for reliable hosted rendering.
- Platform presets must be explicit about size, duration, codec, frame rate, and safe areas.
- Render outputs need storage, expiration, download URLs, and failure reporting.

Do not build full rendering until the product has validated content briefs, song assets, and export requirements.

## SQLite/local storage feasibility

SQLite is feasible for the MVP if the app remains single-service and stores modest project data:

- Song records.
- Lyrics and hooks.
- Content briefs and drafts.
- Campaign groupings.
- References to uploaded files or generated exports.
- Release-readiness report records.

Risks to monitor:

- Large binary files should not be stored directly in SQLite.
- Render outputs should use filesystem/object storage with database references.
- Concurrent write volume may require careful transaction handling.
- Multi-instance deployment may require a managed database later.

## Render/web role

Render remains appropriate for the web app, API, auth, billing, and lightweight generation flows.

Render should initially host:

- Web UI.
- API routes.
- Database-backed song and draft management.
- Existing release-readiness features.
- Text generation endpoints.

Render should not be assumed sufficient for heavy video rendering until worker sizing, timeouts, disk limits, memory, CPU, queue behavior, and storage are validated.

## First implementation steps

1. Add song-centered product and architecture docs as source-of-truth references.
2. Add README or docs index links to the new documents if a docs index exists.
3. Define initial domain schema for `Song`, `SongAsset`, `ContentBrief`, `ContentDraft`, and `Campaign`.
4. Add a song project workspace route without removing existing release-readiness flows.
5. Implement text-only content drafts first: captions, release announcements, social posts, lyric clip scripts, and hook breakdown outlines.
6. Add truthful UI labels for draft/planned/export states.
7. Spike Remotion/FFmpeg separately with a single real local render before adding product claims.
8. Decide whether hosted workers, local rendering, or later Tauri support is needed based on that spike.

## Risks

- Overclaiming video, publishing, analytics, or growth features before real integrations exist.
- Accidentally breaking existing release-readiness flows during the pivot.
- Adding rendering dependencies before understanding hosting limits.
- Storing large media artifacts in the wrong persistence layer.
- Creating a broad content suite before the song-centered workflow is validated.
- Confusing users if old metadata-first messaging and new song-studio messaging coexist without clear positioning.

## What not to build yet

- Direct posting to Spotify, YouTube, TikTok, Instagram, or Facebook.
- Fake social publishing status.
- Fake platform analytics or growth dashboards.
- Full automated video generation without a real render pipeline.
- Desktop/Tauri app before web MVP validation.
- Distribution, royalty, rights, or label-services modules.
- A rewrite of the existing app.
- Removal of release-readiness functionality.
