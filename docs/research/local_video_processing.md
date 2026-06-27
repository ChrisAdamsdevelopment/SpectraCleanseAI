# Local Video Processing Plan for Canvas Loop Engine

_Last updated: 2026-06-27. This is planning only; no production behavior is changed._

## Local-first principle

The Canvas Loop Engine MVP must run on ordinary desktop machines without a GPU, network access, paid APIs, or cloud media upload. AI providers may improve difficult seams later, but local mode owns baseline creator trust, privacy, and repeatable exports.

## Existing FFmpeg primitive

Song Studio Desktop already exposes a thin Tauri command named `run_ffmpeg(args)` that resolves an FFmpeg binary, logs the source, runs caller-provided arguments, and returns the output path and byte size. Render logic is intentionally kept in TypeScript while Rust provides the FFmpeg process bridge.

Existing resolution order documented in the Song Studio Desktop README:

1. app sidecar/bundled FFmpeg,
2. app resource FFmpeg,
3. `node_modules/ffmpeg-static`,
4. system `ffmpeg` on `PATH`.

## Frame extraction plan

- Use `run_ffmpeg(args)` to extract low-resolution analysis frames into a temporary workspace.
- Extract at a configurable sample rate, for example 6-12 FPS for search and exact source FPS near promising candidates.
- Store frame metadata: timestamp, frame index, width, height, orientation, source FPS, and checksum.
- Keep analysis frames separate from export frames so cleanup is safe.

## Video spec validation plan

Validate before analysis:

- readable local file path;
- container and codec FFmpeg can decode;
- duration supports a short loop window;
- dimensions can be cropped/scaled to vertical 9:16;
- frame rate is stable enough for frame-accurate export;
- file size and duration remain within desktop processing budgets;
- output target can be transcoded to MP4/H.264 for Canvas-style sharing.

## Anchor frame selection plan

- Let the creator scrub the uploaded clip and choose an anchor frame.
- Persist anchor time in seconds and frame index, not just UI slider percent.
- Extract the anchor frame as an image for scoring, reporting, preview thumbnails, and future AI-provider requests.
- Support re-selecting the anchor without re-importing the source.

## Candidate loop search plan

Given an anchor time, search candidate end frames after the anchor:

1. Define allowed loop durations, for example 3-8 seconds for Canvas-like loops.
2. Sample candidate end timestamps in that window.
3. Score visual similarity between candidate end frame and anchor frame.
4. Prefer candidates with compatible motion direction and low scene-change risk.
5. Present the best few candidates as previewable loop options rather than a single opaque result.

## Similarity scoring options

CPU-first scoring can start simple and become layered:

- perceptual hash distance for fast frame matching;
- downscaled RGB or LAB mean squared error;
- structural similarity (SSIM) on luminance;
- edge-map or optical-flow-inspired motion continuity checks;
- histogram similarity for abstract/smoke/lightning footage;
- penalty for cuts, large exposure shifts, faces/hands jumping, or camera whips.

The first MVP should favor transparent heuristics and report the score components so failures are debuggable.

## Crossfade export plan

- Trim from anchor time to selected end time.
- Apply a short crossfade between the end and anchor/start, tuned by score and user preview.
- Crop/scale to 9:16 while preserving the creator's selected subject area.
- Export MP4/H.264 using FFmpeg via `run_ffmpeg(args)`.
- Generate a low-resolution preview first, then a final export.

## Ping-pong export plan

Ping-pong is a safe fallback when no good return candidate exists:

- Export forward segment followed by a reversed copy.
- Hide the reversal point with a short blend if needed.
- Warn that rhythmic or directional motion may feel artificial.
- Prefer for abstract motion, smoke/mist, lights, and slow camera moves; avoid by default for dancing or performance clips where body motion reversals are obvious.

## Optional interpolation warning

Frame interpolation can make seams smoother but should not be required for MVP because GPU availability, licensing, runtime cost, and artifacts vary widely. Treat interpolation as an optional future repair tool, not a hard dependency.

## Why local mode must not require GPU

- Desktop creators may be on laptops or older machines.
- GPU-only processing complicates packaging and support.
- Local CPU FFmpeg keeps imports private and avoids paid API calls.
- Baseline loop creation should be available offline.
- AI/GPU repair should be additive, feature-flagged, and failure-tolerant.
