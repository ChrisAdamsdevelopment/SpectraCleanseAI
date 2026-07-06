# Product Definition: Song-Centered Artist Content Studio

> **Current-authority notice (SCRUM-002, 2026-07-06):** This document is preserved as historical pivot context. It is not the current Song Studio product authority. Current doctrine lives in `docs/ai-scrum/START_HERE.md`, `docs/ai-scrum/product-north-star.md`, `docs/ai-scrum/product-outcome-tree.md`, and `docs/ai-scrum/current-state.md`. Where this document conflicts with the directed-release-video doctrine, the SCRUM-002 AI Scrum docs supersede it.

## Project background

SpectraCleanse AI currently focuses on release-readiness workflows: inspecting uploaded audio/video files, removing problematic provenance or metadata markers, injecting platform-oriented metadata, and helping creators prepare files for distribution. That work remains valuable, but it is not the full creative workflow artists repeatedly need after a song exists.

Artists do not only need a cleaner release file. They need a repeatable way to turn one song into the many promotional assets required across short-form video, social platforms, and release campaigns.

## Why the direction changed

The original metadata-first direction solves a narrow readiness problem near the end of a release workflow. The larger recurring user need starts earlier and continues longer: artists need to promote the song itself.

The pivot changes the center of gravity from "file cleanup" to "song-driven content production" because:

- A song can generate many pieces of content over time.
- Promotion requires platform-specific variants, not a single cleaned file.
- Artists need help moving from raw song assets to campaign-ready outputs.
- Existing release-readiness capabilities can become a supporting module instead of the primary product promise.

## What the new product is

The new product is a **Song-Centered Artist Content Studio**.

The song is the source object. A creator imports one song, adds or derives supporting assets, and uses the studio to produce truthful, platform-ready promotional content.

Primary workflow:

```text
Song → Assets → Content → Promotion → Growth
```

Example outputs include:

- Spotify Canvas concepts/exports
- YouTube Short concepts/exports
- TikTok video concepts/exports
- Instagram Reel concepts/exports
- Facebook Reel concepts/exports
- lyric clips
- hook breakdown clips
- visualizers
- promo captions
- release announcements
- social posts
- campaign assets

## What the product is not

The pivot must not overclaim capabilities that do not exist.

The product is not:

- A fake publishing platform that claims to post to Spotify, YouTube, TikTok, Instagram, or Facebook without real integrations.
- A fake analytics product that invents performance, growth, listener, or conversion metrics.
- A fake video generator that pretends to render production-ready video before real rendering/export infrastructure exists.
- A replacement for release-readiness work; that work should remain available as a future or supporting module.
- A full digital audio workstation, distributor, label services platform, or social media management suite.
- A rewrite mandate for the current app.

## Core user problem

Independent artists and small teams struggle to convert a finished song into the consistent stream of promotional material required by modern music marketing. They often need to manually create many platform-specific variants, captions, clips, and campaign posts from the same song, while keeping messaging and visuals consistent.

The product should reduce that effort by making the song the durable source of truth and by guiding users through content creation and campaign preparation.

## Core workflow

1. **Song** — Import or define the song, including audio file, title, artist name, release context, mood, genre, hooks, lyrics, and target platforms.
2. **Assets** — Attach or generate supporting inputs such as artwork, brand colors, lyric text, selected timestamps, captions, images, and visual style notes.
3. **Content** — Create platform-specific content plans and exportable assets, starting with text/caption outputs and later moving into rendered video clips.
4. **Promotion** — Organize generated content into release announcements, social post sequences, and campaign asset groups.
5. **Growth** — Later, connect real performance data and learning loops only after truthful integrations or user-provided metrics exist.

## Core product objects

- **Song**: The central project record. Stores title, artist, audio reference, duration, release status, genre/mood metadata, lyrics, hooks, and target audience notes.
- **SongAsset**: Supporting materials associated with a song, such as cover art, lyric files, waveform data, brand kit values, images, style prompts, and timestamp selections.
- **ContentBrief**: The user-approved intent for a piece of content, including platform, format, goal, tone, audience, and source song moments.
- **ContentDraft**: Generated or manually edited text, shot lists, caption sets, lyric clip scripts, hook breakdown outlines, or visualizer instructions.
- **RenderableAsset**: A future object representing video/audio/image render inputs and outputs once rendering is implemented.
- **Campaign**: A collection of planned promotional assets and posts around a song, release date, or marketing phase.
- **ReleaseReadinessReport**: Existing/future supporting object for metadata, provenance, and distribution-preparation checks.

## MVP definition

The MVP should prove that artists can use one song as the center of a repeatable content studio without pretending unsupported integrations are live.

MVP scope:

- Create a song-centered project workspace.
- Allow users to enter song metadata, release context, lyrics, hooks, and platform targets.
- Preserve or link existing upload/readiness capabilities where safe.
- Generate truthful text-based promotional outputs such as captions, release announcements, social post drafts, content briefs, lyric clip scripts, and hook breakdown outlines.
- Store generated drafts locally or in the existing app database.
- Make outputs copyable/exportable as text or simple files.
- Clearly label any video/rendering feature as planned until real rendering exists.

Out of MVP scope:

- Direct social publishing.
- Real platform analytics.
- Automated video rendering unless a real Remotion/FFmpeg pipeline is implemented and tested.
- Royalty, distribution, or rights-management workflows.
- Claims that generated content is guaranteed to improve reach.

## Technical direction

The first implementation should be documentation-led and additive. Do not rewrite the app. Do not remove release-readiness work.

Recommended direction:

- Keep the current web app as the primary interface for the MVP.
- Add song-centered domain models and routes incrementally.
- Treat release-readiness as a module that can attach to a Song or SongAsset.
- Start with text and planning outputs before rendered video.
- Use existing authentication, billing, upload, database, and deployment patterns where they are still fit for purpose.
- Introduce rendering infrastructure only after a scoped spike validates Remotion/FFmpeg requirements, hosting constraints, queueing, storage, and export formats.
- Keep all user-facing claims tied to implemented functionality.

## Implementation truthfulness rules

- Do not describe planned integrations as active integrations.
- Do not generate fake analytics, fake listener data, fake revenue, fake platform performance, or fake publishing status.
- Do not imply that the app posts to third-party platforms unless OAuth, API permissions, posting flows, and error handling are implemented.
- Do not imply that video has been rendered unless a real render artifact exists.
- Do not silently replace release-readiness with the new studio; preserve it as existing/future support.
- Label concept, draft, planned, beta, and export states clearly in UI and docs.
- If an output is AI-generated text, present it as a draft for user review.
- If a feature depends on user-provided data, say so explicitly.
