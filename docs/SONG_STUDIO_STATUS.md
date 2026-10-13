# Song Studio status and evidence boundaries
Last verified source: Windows local branch `claude/alpha-001-test-user-readiness`, commit `5f7b34230e2e5a1865a92f40cdfa014938eeac8e` (July 16, 2026). Subsequent publishing may change the Git hash.

## Implementation present
- Tauri v2/Rust native desktop shell with React + TypeScript creative workspace; artist song/audio + cover-art project source.
- Local FFmpeg MP4 rendering of Canvas loops, hook promos and visualizers; per-song project save/open and no-overwrite path behavior.
- Director Mode work: visual library, scene board, casting/reference handling, song-relative lyric and pose direction, generation take tracking, manual generation packet and result bridge, review/repair, and assembled workprint.
- Adapters for supported Google/Veo and xAI/Grok services; capability flags prevent unsupported operations from being silently advertised.
- Settings/recovery/diagnostics infrastructure, OS-based secure credential handling, per-provider routing and updater/packaging setup.
- Tests and synthetic video smoke scripts for director model/logic/assembly, Tauri host integration, credential routing, security, recovery, updater and version staging.

## Important limitations (not yet demonstrated as production)
- Live AI media generation under real provider accounts and credentials was **not tested** in the local release notes. A mock and manual bridge are not evidence that an external provider produced the intended film.
- No verified clean-machine installer run or successful end-to-end update delivery; the updater public key is empty and signing setup is user-dependent.
- The Windows installer is not code signed; distributing a build requires separate release security/SmartScreen considerations.
- Preview and FFmpeg output are not guaranteed visually identical, and not all control paths have pixel parity.
- The director feature slices are implemented, but final creator-quality and owner acceptance were not independently verified by the engineering report.
- Root historical web infrastructure does not represent this app and was intentionally retired from the active product tree.

This status page is the engineering baseline, not a promise of commercial launch, universal model support, deployment, or guaranteed artistic quality.

## Current migration verification — October 12, 2026

- Local Windows checks: 9 of 10 selected validations passed (TypeScript typecheck, build, director-model/logic tests, app security, host integration, recovery, alpha configuration and Director MP4 assembly smoke).
- Full-resolution FFmpeg `render:smoke` remains **not passing on the examined 8 GB Windows machine**. FFmpeg reported `Cannot allocate memory` while rendering multi-layer 1080 x 1920 compositions; limiting FFmpeg threads allowed the standalone Canvas test to complete, but longer audio/video variants still failed. Do not mark full video export or render:smoke as universally validated.
- Desktop dependency lockfile received compatible npm audit fixes. Post-fix audit: **0 high, 0 critical, 0 moderate and 1 low** (esbuild development-server exposure) on Oct 12, 2026. Future advisories may change. New CI audits at high severity and runs core tests plus workprint assembly; full high-resolution render smoke is a separately documented resource-sensitive validation.
- No provider video-generation API was called in this migration. No signed installer or updater delivery was tested.
