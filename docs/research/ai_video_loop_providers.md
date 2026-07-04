# AI Video Loop Providers Research

_Last researched: 2026-06-27. Official Google sources were prioritized. No API calls were made._

## Canvas Loop use case

Song Studio Desktop needs a provider-neutral path for AI-assisted Spotify Canvas loop creation: a creator uploads a short portrait video, selects an anchor frame, and the app asks an optional AI provider to create or repair a short vertical clip whose ending returns smoothly to that anchor frame.

## Gemini/Veo capability table

| Question | Current finding | Source |
| --- | --- | --- |
| Portrait 9:16 video | Supported for Veo 3.1 generation models. | Google AI docs say Veo 3.1 supports portrait `9:16` and landscape `16:9`; Google Cloud model specs list both aspect ratios. |
| First-frame image-to-video | Supported. | Veo 3.1 model specs list image-to-video support. |
| First-frame and last-frame generation | Supported by Veo 3.1 / 3.1 Fast GA; preview on Lite and older preview IDs. | Google AI docs describe frame-specific generation; Google Cloud specs list “Generate videos from the first and last frames.” |
| Same or similar anchor as first and last frame | Likely possible as an input strategy, but not documented as a guaranteed seamless-loop control. | The API accepts first and last frames; seamless return quality must be validated by tests. |
| Video extension | Supported for Veo 3.1 and 3.1 Fast; not available for Veo 3.1 Lite in the Gemini API guide. Extension is preview in Google Cloud model specs. | Google AI docs say extension works with Veo 3.1 and is not available for Lite; Cloud specs mark extension as preview. |
| Model IDs supporting extension | `veo-3.1-generate-001`, `veo-3.1-fast-generate-001`; preview IDs `veo-3.1-generate-preview`, `veo-3.1-fast-generate-preview`. Avoid deprecated preview IDs. | Google Cloud specs. |
| Model IDs supporting first/last-frame generation | `veo-3.1-generate-001`, `veo-3.1-fast-generate-001`; `veo-3.1-lite-generate-001` lists it as preview; preview IDs also support it but are deprecated/removed. | Google Cloud specs. |
| Durations | 4, 6, or 8 seconds for Veo 3.1 Cloud specs. Gemini API guide states Veo 3.1 durations are 4/6/8 seconds, with 1080p/4k and reference-image outputs constrained to 8 seconds in some API contexts. | Google AI docs and Cloud specs. |
| Resolutions | Cloud GA specs: 720p and 1080p input/output for `veo-3.1-generate-001`, Fast, and Lite. Gemini API guide additionally discusses 4k for Veo 3.1 non-Lite, but notes extension is limited to 720p. | Google AI docs and Cloud specs. |
| Framerate | 24 FPS. | Google AI docs and Cloud specs. |
| MIME/file format | `video/mp4`. | Google Cloud specs. |
| Pricing | Gemini API paid tier only. Veo 3.1 Standard: $0.40/s at 720p or 1080p, $0.60/s at 4k. Fast: $0.10/s 720p, $0.12/s 1080p, $0.30/s 4k. Lite: $0.05/s 720p, $0.08/s 1080p, no 4k. | Google AI pricing. |
| Quotas/rate limits | Google Cloud specs list regional online prediction requests per base model per minute: 50 for GA `veo-3.1-generate-001`, 50 for Fast, 50 for Lite, 10 for `veo-3.1-generate-preview`, 50 for `veo-3.1-fast-generate-preview`. Gemini API rate limits are tier-dependent and can change. | Google Cloud specs; Gemini rate-limits page. |
| Deprecation/preview notes | `veo-3.1-generate-preview` and `veo-3.1-fast-generate-preview` are discontinued on 2026-04-02 in Cloud specs. Google AI pricing warns Veo 3 and Veo 2 shut down on 2026-06-30. Preview models may change and have stricter limits. | Google Cloud specs; Google AI pricing. |
| Provenance/watermarking | Google Cloud specs list Content Credentials (C2PA). Google’s Veo materials also state generated videos include SynthID watermarking. | Google Cloud specs; Google developer blog. |
| Commercial/product use | Cloud preview text says customers may elect to use the preview offering for production or commercial purposes subject to their access agreement. Gemini API Additional Terms warn users to use discretion before publishing or using generated content. Legal review is still required before launch. | Google Cloud specs; Gemini API Additional Terms. |

## Supported inputs and outputs

- Inputs: text and image for GA Veo 3.1/3.1 Fast Cloud model IDs; Lite’s Cloud page inconsistently says “Text” in the summary while listing image-to-video-related capabilities as preview, so treat Lite image features as unresolved until confirmed against the exact API path.
- Outputs: generated MP4 video at 24 FPS.
- First-frame support: supported.
- Last-frame support: supported for first/last-frame generation.
- Reference image support: up to three reference images in the Gemini API guide; Cloud specs mark reference asset images as preview for Standard/Fast and unsupported for Lite.
- Extension: provider can extend previously generated Veo video, but extension is not a general uploaded-video repair primitive and is limited to 720p in the Gemini API guide.

## Feasibility verdict for Canvas Loop Engine

Veo is feasible as a future premium AI-assisted loop provider, especially for generating an 8-second portrait MP4 from an anchor frame and a matching final anchor frame. However, it should not be the MVP foundation because:

1. The seamless-loop guarantee is not explicit; first/last-frame conditioning only encourages the desired return.
2. Extension appears designed for Veo-generated clips, not arbitrary user-uploaded videos.
3. Costs are per generated second and paid-tier only.
4. Preview and deprecation churn is active.
5. Output provenance, watermarking, content safety, and commercial-use terms need product/legal review.

## Key limitations for our use case

- No documented “make this uploaded clip loop perfectly back to this exact frame” endpoint.
- First/last-frame generation can help generate loop-shaped clips, but human review and local scoring remain necessary.
- 24 FPS output may differ from user source footage or Spotify Canvas expectations.
- Provider APIs may impose safety blocks or person-generation constraints.
- AI output may include audio by default; Canvas export likely needs muted video or explicit audio handling.
- Extension is 720p-limited and not available for Lite in the Gemini API guide.
- Preview IDs and older Veo versions are changing or being removed.

## Open questions

- Which Google API path should Song Studio use if implemented: Gemini API, Vertex AI, or Gemini Enterprise Agent Platform?
- Does first/last-frame generation accept the exact same image for both start and end, or should the end frame be a near-duplicate with prompt guidance?
- Can generated audio be disabled consistently for Canvas use?
- What exact terms, attribution, disclosure, and user consent requirements apply to commercial musicians using generated outputs?
- Can provider outputs satisfy Spotify Canvas upload constraints without additional transcoding?
- What quality threshold should trigger AI repair versus local crossfade/ping-pong export?

## Official sources consulted

- Google AI for Developers, “Generate videos with Veo 3.1 in Gemini API”: https://ai.google.dev/gemini-api/docs/video
- Google Cloud, “Veo 3.1” model specification: https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate
- Google AI for Developers, “Gemini Developer API pricing”: https://ai.google.dev/gemini-api/docs/pricing
- Google AI for Developers, “Rate limits”: https://ai.google.dev/gemini-api/docs/rate-limits
- Google AI for Developers, “Gemini API Additional Terms of Service”: https://ai.google.dev/gemini-api/terms
- Google Developers Blog, “Build with Veo 3, now available in the Gemini API”: https://developers.googleblog.com/veo-3-now-available-gemini-api/
