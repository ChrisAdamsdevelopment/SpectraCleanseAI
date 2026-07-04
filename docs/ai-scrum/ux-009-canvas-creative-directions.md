# UX-009 — Canvas Creative Directions V1

Story ID: UX-009  
Story title: Canvas Creative Directions V1  
Status: EXECUTED — OWNER ACCEPTANCE REQUIRED (user-facing; owner must test the running Tauri app)  
Completion level: Owner-Reviewable Product Story

## Outcome

Canvas now starts from a deliberately small seed pack of three creator-facing directions instead of one narrow built-in look. The product rule for this slice is:

**CREATIVE DIRECTION BEFORE PARAMETER TUNING.**

The creator should choose between a few strong Canvas directions before they ever need to touch a technical control.

## Direction rules recorded for future work

- Canvas should provide a few strong choices before more controls.
- Every creator-visible Canvas direction must be export-real: the live preview and exported MP4 must be driven by the same recipe/template/composition values.
- The seed pack is deliberately small. Do not mass-produce near-duplicate presets.
- Do not expose blur, contrast, saturation, title coordinates, vignette, FFmpeg filters, or other render parameters as the first creative surface.
- Multi-image rendering, AI generation, variation systems, beat/loop intelligence, seam scoring, and Canvas Lab integration remain future tracks until those capabilities are genuinely wired into the creator-facing render path.

## Implemented seed pack

- **Clean Release Card** — preserves the existing calm/minimal Canvas direction.
- **Midnight Frame** — darker cinematic Canvas treatment with larger cover presence, stronger vignette, deeper grade, and bolder readable title.
- **Full Glow** — more immersive/saturated Canvas treatment with oversized cover presence, stronger background color, and minimal low text.

All three are built as recipes/templates, not UI-only cards.

## Architecture decision

Canvas directions are scoped through the existing recipe model using exact `functionIds` compatibility where needed. This preserves the long-term recipe/share/fork/AI-modify direction while preventing Canvas-only looks from leaking into unrelated output types.

## Anti-drift notes

- Keep Canvas creative choices contextual inside the Canvas workspace.
- Do not turn Canvas into a generic video editor.
- Do not claim AI, beat sync, seam scoring, loop repair, parallax, or multi-image composition until the export path implements it.
