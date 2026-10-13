# Song Studio Desktop

**A local-first creative workspace for making music videos from finished songs.**

This is the active application in the SpectraCleanseAI repository. The repository retains its historical URL, but its active product is **Song Studio**.

The creator brings a song, artwork, imagery and lyrics into a **Release Project**, then decides what kind of video to make. The studio helps them arrange scene ranges, visual references, identity and creative instructions; generate or import footage; accept and repair takes; and assemble the result into song-synchronized video.

## Product workflow

1. **Start with the song.** Import audio and cover art, define artist and title, create a Release Project.
2. **Choose an output.** Canvas-like loop, short hook clip, visualizer or a directed multi-scene workprint.
3. **Direct the visual world.** Use the visual library, scene board, lyric lane, scene references, and pose/intent tools to determine what should happen at specific song moments.
4. **Prepare media.** Compile provider-neutral generation packets and choose a supported, configured model adapter, or use the manual package/result bridge. No paid generation is required to run mock tests or local render demonstrations.
5. **Review and assemble.** Compare takes, accept/reject/repair scenes, and use local FFmpeg to assemble an MP4 with the song audio.

## Implementation

| Layer | Current technology | Key paths |
| --- | --- | --- |
| Desktop application | Tauri v2 / Rust | `src-tauri/` |
| Creative UI | React + TypeScript + Vite | `src/App.tsx`, `src/director-ui/`, `src/canvas-ui/` |
| Project model | Release Project + migration/recovery + scene states | `src/project/`, `src/app/` |
| Director/AI orchestration | Independent scene model, preflight, packet compiler, optional adapters | `src/director/` |
| Video output | FFmpeg local rendering and audio-synchronized workprint assembly | `src/render/`, `render-core/` |
| Privacy | OS-backed credential storage/session fallback; tests and redaction | `src/app/secureStore.ts`, `src/app/security.test.mts` |

The app separates artist decisions from external provider capabilities. A provider-neutral generation contract and a functioning manual bridge are not evidence that a particular third-party model is connected or has been tested end-to-end with real provider credentials.

## Windows development

Requires Node.js 20.19+ or 22.12+, stable Rust, MSVC Build Tools and functional FFmpeg (often available through `ffmpeg-static` after dependency installation).

```powershell
cd apps/song-studio-desktop
npm ci
npm run typecheck
npm run build
npm run tauri dev
```

### Core validation

```powershell
npm run director:model:test
npm run director:logic:test
npm run app:security:test
npm run host:integration:test
npm run app:recovery:test
npm run render:smoke
npm run director:assembly:smoke
```

These scripts operate on test fixtures and local render tools; they do not intentionally issue real AI generation requests. On the examined 8 GB Windows device, the high-resolution `render:smoke` did not pass because FFmpeg exhausted available memory. Check the [status report](../../docs/SONG_STUDIO_STATUS.md) rather than treating this as a green CI result. Run `npm run alpha:config:test` for updater/release configuration assumptions. See `package.json` for all available tests.

## Where the app is today

**Windows alpha/development state, not a widely released commercial product.**

- Local deterministic MP4 rendering, preview and scene assembly have implemented code and smoke tests.
- Director tools and generator adapters exist, but live provider integration remains conditional on supported capabilities, valid credentials and user spending approval. Provider-enabled workflow results have not been independently verified in the alpha handoff.
- Preview and MP4 rendering differ for some layer controls and typography. Inspect exported output.
- Windows signing, updater public-key configuration, clean-device installation, end-to-end update delivery, and broader tester acceptance need additional work.
- There is no verified automatic publishing to music or social platforms, and no demonstrated guarantee that produced videos will improve distribution results.

## Documentation

- [Current implementation and evidence boundaries](../../docs/SONG_STUDIO_STATUS.md)
- [Product North Star](../../docs/ai-scrum/product-north-star.md)
- [Engineering architecture and portfolio walkthrough](../../docs/ENGINEERING_PORTFOLIO.md)
- [Alpha developer/credential reference](../../docs/alpha/DEVELOPERS.md)
- [Alpha build and publishing operator guide](../../docs/alpha/RELEASE-OPERATOR.md)

The app and its evolving user interface are the current product; historical commits are not the description of what Song Studio does now.
