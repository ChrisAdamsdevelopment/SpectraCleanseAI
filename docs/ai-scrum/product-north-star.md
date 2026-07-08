# Song Studio Product North Star

## Product mission and active North Star

Song Studio's larger product mission — persistent creative context, situational awareness, decision support, and coordinated execution capability for independent artists — sits above this North Star and explains what it ultimately contributes toward. See `docs/ai-scrum/decisions/DEC-002-product-mission-active-wedge-and-future-horizons.md` for the full mission statement, core loop, and doctrine.

**NS-001 — Directed Release Video System, described below, is the only active North Star.** Two future horizons (NS-002 — Release Campaign Intelligence, NS-003 — Artist Continuity & Identity) are named in DEC-002 as inactive; they are not approved roadmaps, capabilities, or stories, and require explicit owner activation before any work against them is authorized.

## Outward product promise

> Your song is finished. Song Studio helps create everything you need to promote it.

Supporting explanation: turn one finished song into release visuals from one reusable Release Project.

## North Star outcome

An independent artist with a finished song can use Song Studio to direct, generate, revise, and finish genuinely modern release videos without becoming a video editor or gambling expensive generations on prompt-only randomness.

The creator should feel like a **director** or **producer**, not a professional video editor and not a prompt-lottery player.

## Central creative doctrine

> The artist directs the relationship between the song and the visual world. Song Studio makes the video.

The song is the temporal spine. The creator places intention. Song Studio creates execution.

## Release Project doctrine

The Release Project is the product container and reusable source of truth. Over time it may contain song, cover art, artist images, identities, logos, lyrics, visual references, creative direction, generated media, output history, and release-specific information.

One Release Project can create many Outputs. The editor, Canvas workspace, and any generated clip are not the product by themselves; the reusable Release Project connects the work.

## Real video, not animated artwork

A static image that zooms, pans, rotates, pulses, flips, floats, sits over a blurred copy, gains waveform/particles/color changes, or moves on a beat can be a useful ingredient. It is not, by itself, the target creative product.

Song Studio must move toward directed temporal video with meaningful evolution: visual states, scenes, generated motion, subject motion, camera motion, transformations, reveals, meaningful cuts, directed visual events, typography events, composited material, continuity, authored beginnings/endings, and loop-aware progression may all be available techniques. No single output must use every technique.

The durable requirement is **temporal evolution with intent**.

## Current renderer boundary

The current deterministic single-image renderer is real implementation and should be preserved. It may remain useful for motion artwork, deterministic scenes, title/end cards, logos, safe typography, fallback compositions, and Canvas-specific motion-art treatments.

It is not the creative ceiling. Future agents must not assume that endlessly extending blur, cover scale, zoom, particles, waveforms, and background treatments will become the modern directed-video engine. The current renderer is one composition path inside a larger future directing system.

## Eight-second strategy

Short Canvas-like sequences are strategic because one genuinely good directed sequence that survives repetition over the life of a song can teach mechanics that scale into 10-15 second videos, 30 second promos, longer promotional videos, and eventually multi-minute videos.

Do not reduce the strategy to “start with Canvas because it is easier.” Do not assume the solution is stretching or repeating one eight-second clip. Canvas introduces a loop contract; linear videos introduce a next-sequence contract.

## Directing timeline doctrine

Song Studio needs time-based control, but must not expose a professional editing timeline as the primary experience.

A traditional editing timeline centers clips, tracks, frames, keyframes, easing curves, and manual transitions. The Song Studio directing timeline centers the real song, meaningful song regions, people, identities, visual ingredients, references, importance, creative intention, what belongs where, what should change, what must remain, and what can be invented.


## Simple interface / powerful outcome doctrine

Do not avoid powerful outcomes. Avoid powerful interfaces.

Song Studio may need sophisticated time, music analysis, scene planning, generation, compositing, identity control, and revision systems. The creator should not be forced to operate those systems at professional-editor complexity. This does not mean hiding all control: the creator needs meaningful control over the decisions that matter, expressed through progressive disclosure and causal directing choices.

## Anti-drift rules

- Owner examples are not specifications unless explicitly stated. Ask what general capability an example reveals.
- No control without causality: a visible control or decision must change the generation/composition plan and be testable against the result.
- Cheap intelligence before expensive generation: AI should earn the generation by interpreting intent, song analysis, opportunities, conflicts, plans, provider requests, and likely cost before paid media generation.
- Pre-generation direction must distinguish MUST constraints, SHOULD preferences, and OPEN invention space.
- Do not create passive abstractions and count them as progress.
- A technically valid MP4 is not success; the future quality question is “would I be proud to release this?”

## Conceptual direction chain

The likely scalable product architecture direction is:

`SONG → SONG MAP → USER INTENT → CREATIVE OPPORTUNITIES → DIRECTION CUES → DIRECTION CONTRACT → DIRECTED SEQUENCES → SCENES → GENERATED + DETERMINISTIC MATERIAL → VALIDATION → REVISION → FINAL OUTPUT`

This is not an approved schema. Every new system boundary must name its first creator-facing consumer.

## Open decisions not settled here

The exact first runtime slice, Canvas versus vertical teaser as first proof, Song Map implementation, directing-timeline interaction model, cue taxonomy, Directed Sequence schema, generation providers, cloud/local split, BYOK versus credits, pricing, identity representation, tattoo/detail validation, and loop-fit scoring remain open.
