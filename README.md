# Song Studio
**Direct music videos around your songs.**

Song Studio is a **desktop-first music-video creative workspace** for independent artists. Bring a finished song, artwork, lyrics and visual references into a reusable Release Project; plan scenes and creative direction, generate or import moving footage, then review and assemble videos around the real song.

This repository was formerly branded SpectraCleanseAI. **Song Studio is the active product**. The old web product has been retired from the current codebase and is available only through Git history.

> **Current maturity: Windows desktop alpha / engineering prototype.** The product is not a generally released or professionally signed installer. Certain generation providers require your own account and API credentials. Live end-to-end generation across providers, clean-machine install and update delivery are not claimed as verified.

## The actual application

[**Open Song Studio Desktop source →**](apps/song-studio-desktop/)

- **Song-centered project workflow:** reusable Release Projects keep song audio, creative references, lyrics, clips, scenes, output settings and work-in-progress together.
- **Director workspace:** scene board, visual library, lyric/pose controls, reference variants, generation takes, acceptance/repair, and workprint assembly.
- **Video generation interface:** provider-aware adapters for Google/Veo and xAI/Grok with recorded capabilities, prompt/packet compilation, manual export/import bridge, and credential-aware routing. Provider usage may incur costs; no claim of universal feature parity.
- **Local MP4 output:** FFmpeg-backed renders for Canvas loops, hook promos and visualizers, plus assembling accepted scene footage to the song; validation includes synthetic smoke tests.
- **Canvas composer:** edit layers, timing, visuals and song-relative cues; the preview approximates rendered output and has documented parity limits.
- **Desktop foundation:** Tauri v2/Rust shell with a React + TypeScript interface; native file dialogs, OS-backed secrets, recovery, diagnostics and staged FFmpeg packaging work.

The intended user experience is: **Song → assets → direct scenes → generate/import shots → review/repair → assemble/export**. The artist directs; the software coordinates the production work.

## Architecture at a glance

```text
Song / Release Project (.ssproj)
    |-- song audio, artwork, lyrics, visual references
    |-- creative direction + scene board + provider-independent takes
    |-- canvas output / hook video / visualizer
    |
    +-- Director model + preflight + GenerationPacket compiler
    |      +-- provider adapters (optional credentials/network spend)
    |      +-- manual generation package import/export
    +-- local FFmpeg render + workprint assembler
    +-- Tauri native host (filesystem, OS credential store, updater)
    +-- React / TypeScript creative workspace
```

Source of truth: [product North Star](docs/ai-scrum/product-north-star.md), [current verified status](docs/SONG_STUDIO_STATUS.md), [desktop architecture and usage](apps/song-studio-desktop/README.md), and [alpha developer guide](docs/alpha/DEVELOPERS.md).

## Run locally (Windows development)

Prerequisites: Node.js 20.19+ or 22.12+, Rust stable, MSVC Build Tools, and FFmpeg. The npm dependency tree includes `ffmpeg-static` as a development fallback. A signed distributable and in-app updater are **not automatically available** from this source checkout.

```powershell
cd apps/song-studio-desktop
npm ci
npm run typecheck
npm run build
npm run render:smoke
npm run tauri dev
```

The above uses the local build, not a real video-generation API. The video-render smoke run creates short synthetic outputs and requires a functional FFmpeg binary. Individual test scripts are listed in [the desktop package manifest](apps/song-studio-desktop/package.json). Run only the relevant tests when checking a changed feature. **Full-resolution FFmpeg smoke renders can exceed memory available on an 8 GB Windows device; this is a currently documented limitation, not a passing test.** See the status log.

### Credentials and privacy

For optional generation providers, use the application's secure connection flow. Keys belong in the OS credential store or ephemeral session memory, never in project files, screenshots, committed sources, or published demos. Provider spending and footage rights are the operator's responsibility. Consult [alpha security notes](docs/alpha/DEVELOPERS.md) before deploying or extending the tool.

### Known limits

- An FFmpeg video export proves technical rendering, not that the result meets creative standards.
- CSS previews are not pixel-identical to final MP4s; some settings have preview/export differences.
- The current alpha requires more clean-install, signing, updater, provider and real-creator workflow testing.
- AI-directed video output depends on external provider capabilities, account access and actual results. Unsupported model features must not be advertised.
- There is **no promise of automatic social posting, measured marketing growth or an always-on hosted service**.

## Engineering review

See [Engineering portfolio and demo path](docs/ENGINEERING_PORTFOLIO.md) for the system boundaries, meaningful tests and reproducible demonstrations.

## Project status

The newest local alpha implementation was developed on the `claude/alpha-001-test-user-readiness` branch and incorporated into this active Song Studio migration. Code and docs can still evolve; the published commit hash and CI run are the authoritative representation for a specific revision.

Licensed under the [MIT License](LICENSE).
