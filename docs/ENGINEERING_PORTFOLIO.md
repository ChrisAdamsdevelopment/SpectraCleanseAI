# Engineering portfolio: Song Studio desktop
**Role fit:** applied AI product engineering, multimodal orchestration, full-stack/desktop UI and video pipeline integration.

## System walkthrough
1. Load a finished song and make a Release Project. Inspect project normalization and versioned persistence (`apps/song-studio-desktop/src/project/`).
2. Define visual references, scene ranges, lyrics and creative intention in the Director workspace (`src/director-ui/`).
3. Compile a provider-independent generation packet with capability checks, then route to a supported provider or use the manual request/result bridge (`src/director/`).
4. Track generated takes, approve/repair selections and place footage in song-time ranges. Assemble an FFmpeg workprint (`src/render/`, `src/director/assembly.ts`).
5. Export a deterministic Canvas loop, hook clip or visualizer; compare the live preview with actual MP4 output (`src/canvas/`, `render-core/`).
6. Verify the Tauri host/credential boundary, session recovery and files with the appropriate tests (`src/app/`, `src-tauri/`).

## Reproducible local review
```powershell
cd apps/song-studio-desktop
npm ci
npm run typecheck
npm run build
npm run director:model:test
npm run director:logic:test
npm run app:security:test
npm run host:integration:test
npm run render:smoke
npm run director:assembly:smoke
```

`render:smoke` and `director:assembly:smoke` run local FFmpeg with synthetic assets, not paid video providers. Some scripts may require platform-specific dependencies. Inspect the output and report actual test results rather than assuming all controls are wired.

## Engineering decisions
- Keep the song as the temporal reference for all scene direction and output intervals.
- Separate creative intent and provider-neutral requests from specific external API capabilities.
- Keep secrets in OS credential storage/session memory and verify error redaction.
- Use deterministic local rendering for composition and workprint assembly; do not mislabel a local FFmpeg transformation as generative AI film.
- Preserve explicit preview/export differences, provider capability limits, project migration tests and output provenance.

## Release limitations
This is a **development/alpha portfolio**, not a verified signed production installation or universal end-to-end AI video generator. See [status](SONG_STUDIO_STATUS.md) and the [alpha operator guide](alpha/RELEASE-OPERATOR.md).
