# Canvas Loop Engine Roadmap

_Last updated: 2026-06-27._

## Product vision

Canvas Loop Engine helps musicians turn a finished song moment into a short vertical video loop worth posting. The creator uploads or imports a short clip, selects the frame they want the loop to return to, and Song Studio finds, previews, repairs, and exports a smooth Canvas-style loop.

## MVP scope

- Local-only import and validation for short video clips.
- Anchor frame selection.
- CPU-first frame extraction through existing FFmpeg bridge.
- Candidate end-frame search.
- Transparent loop scoring.
- Crossfade export.
- Ping-pong fallback export.
- Report output for lab testing.
- No cloud upload and no AI provider dependency.

## Non-MVP scope

- Real Gemini/Veo API integration.
- Paid API calls.
- GPU-required interpolation.
- Multi-provider marketplace.
- Full generic video editor controls.
- Old root web app work.
- Automated publishing to Spotify or social platforms.

## Future AI-assisted scope

- Feature-flagged `AIProviderInterface`.
- `GeminiVeoProvider` that can request portrait first/last-frame generation.
- Optional same-anchor first/last-frame generation experiments.
- Optional seam repair or replacement clip generation.
- Cost estimates before each AI request.
- User consent before media upload.
- Provenance and watermark disclosure in reports and UI.
- Provider output normalization through local FFmpeg before export.

## Feature flag plan

- `canvasLoop.localMvp`: enables local analysis and export.
- `canvasLoop.reports`: enables lab report writing.
- `canvasLoop.aiProviders`: enables provider registry only.
- `canvasLoop.geminiVeo`: enables Gemini/Veo adapter after legal/product review.
- `canvasLoop.paidRequests`: separate explicit gate for any paid API call.

## Branch plan

- Documentation/research branch: `feature/canvas-loop-research-docs`.
- Future implementation branch should be based on the active Song Studio Desktop foundation line, not `main` and not PR #51.
- Keep local MVP implementation separate from AI provider implementation.

## Recommended MVP sequence

1. Add internal data types for loop specs, anchor metadata, candidates, scores, and reports.
2. Implement `VideoSpecValidator` and `FrameExtractor` on top of existing FFmpeg invocation.
3. Build anchor selection persistence and frame extraction.
4. Implement candidate search and first-pass similarity scoring.
5. Export crossfade and ping-pong previews.
6. Add test-lab report generation.
7. Run the CanvasLoopLab fixture matrix and tune scoring.
8. Only after local MVP quality is understood, prototype `AIProviderInterface` with mocked providers.
9. Add Gemini/Veo only behind feature flags, consent, cost display, and provenance reporting.

## Definition of done

- A creator can select an anchor frame and export a local MP4 loop without network access.
- The app can explain why it selected a loop candidate.
- Test reports capture timing, score, method, file size, and human rating.
- Failures are archived with enough evidence to improve scoring.
- AI provider code is not required for MVP and cannot be reached without explicit flags.
- No production code is changed by this documentation pass.

## Risks

- Good loop detection is content-dependent; dancing and fast motion may fail more often than smoke, mist, or abstract clips.
- Crossfades can hide visual seams but not semantic motion jumps.
- Ping-pong can look unnatural for people or instruments.
- FFmpeg availability differs by platform and package mode.
- AI provider APIs are costly, changing, and not guaranteed to create exact seamless loops.
- Legal and disclosure requirements for AI-generated commercial promo assets need review.

## Open decisions

- Minimum and maximum loop duration for the first shipped MVP.
- Whether reports should be JSON, CSV, Markdown, or all three.
- How much manual control to expose without turning Song Studio into a generic editor.
- Whether Spotify Canvas-specific constraints should be hard validation or export presets.
- Exact quality threshold for suggesting AI repair in the future.
