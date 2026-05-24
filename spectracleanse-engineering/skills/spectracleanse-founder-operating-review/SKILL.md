# spectracleanse-founder-operating-review

**Use this skill instead of a daily standup or sprint review.** For a solo founder shipping SpectraCleanse, this replaces generic planning with a concrete engineering and product review: what shipped, what's in flight, what risks need attention today, and what the single highest-leverage next move is.

---

## SpectraCleanse context

SpectraCleanse is a solo-founder product. The engineering surface includes:
- A 637-line `server.js` monolith (auth, billing, upload, processing, SEO proxy, SPA serving)
- A single-file `app.tsx` React frontend
- SQLite database on Render/Hyperlift with a persistent disk requirement
- ExifTool-based server-side processing for MP4/M4A
- Browser-side MP3 processing via `browser-id3-writer`
- Stripe subscription billing (Creator $9.99, Studio $29.99, Free 3 files/month)
- Gemini `gemini-2.5-flash` for SEO metadata generation
- No automated tests beyond a CI smoke test of `/api/health`
- Manual QA via `docs/manual-qa-checklist.md`

High-risk areas to watch every week:
- Stripe webhook delivery (plan upgrades silently dropped if webhook misconfigured)
- SQLite persistence (data lost if Render disk is not mounted)
- ExifTool correctness (core product guarantee — no automated regression detection)
- Frontend API URL (`VITE_API_URL` — must be set at build time, not runtime)
- Node version pin (20.20.2 — CI uses 18, production uses 20.20.2)

---

## Review protocol

To produce a useful review, gather:
1. Recent commits (last 24–72 hours): `git log --oneline -20`
2. Current deploy state: is the last CI run green? Is Render/Hyperlift showing the latest commit?
3. Any open issues or PRs in GitHub
4. Any Stripe webhook events that failed in the Stripe Dashboard (Developers → Webhooks → event log)
5. Any user-reported issues (email, support channel)
6. Current `docs/manual-qa-checklist.md` completion state (if a deploy was recent)

If live tooling is not connected, ask the founder to provide:
- `git log --oneline -20` output
- CI status for the last push to `main`
- Any error reports or symptoms they're aware of

---

## Output format

```
## Shipped (last 24–72 hours)
[What code changes landed. Cite commit messages or file names. Note if any touched high-risk areas: server.js, cleansePolicy.js, processor.js, Stripe webhook, CORS config.]

## In progress
[What is currently being worked on. Note any half-finished changes that could cause issues if the dev machine is lost or the developer is unavailable.]

## Risks
[Active risks right now — ranked by severity. Examples:
- No tests for Stripe webhook processing
- Historical note: previous `legacy backend env var` vs `VITE_API_URL` mismatch is resolved; `.env.example` and `app.tsx` now align.
- CI uses Node 18, production uses Node 20.20.2
- WAV/FLAC accepted by Multer but rejected by processor (bandwidth waste + user confusion)
- README still claims WAV/FLAC support in marketing copy]

## Friction (user-facing or billing)
[Any known friction in the product: error messages that are confusing, upgrade flow issues, format rejection UX, auth edge cases, slow processing on large files]

## Highest-leverage next move
[The single most valuable thing to work on next. Consider: what reduces the most risk? what unblocks revenue? what improves user trust?
Examples of high-leverage moves for SpectraCleanse right now:
- Fix VITE_API_URL in .env.example to match app.tsx
- Pin CI to Node 20.20.2 to match production
- Add Phase 1 smoke tests to CI (auth round-trip, format rejection, mock checkout)
- Correct README format support claims (WAV/FLAC overclaim)
- Add Stripe webhook event log monitoring
- Document persistent disk setup clearly in deploy.md]

## Next 3 actions
[Concrete, completable within 24 hours:
1. [Action] — [estimated time] — [why now]
2. [Action] — [estimated time] — [why now]
3. [Action] — [estimated time] — [why now]]

## Blockers
[Anything that prevents progress: missing credentials, unclear requirements, waiting on third-party, infra that needs manual action]
```

---

## High-leverage backlog items for SpectraCleanse (current state, May 2026)

These are standing items that should appear in reviews until resolved:

| Item | Risk if unresolved | Effort |
|---|---|---|
| Fix `VITE_API_URL` in `.env.example` | Developer confusion, broken local dev | 5 min |
| Pin CI to Node 20.20.2 | Node version drift between CI and production | 10 min |
| Correct README format claims (WAV/FLAC overclaim) | User trust, support load | 15 min |
| Add Phase 1 smoke tests to CI | No automated regression detection for auth, format gating, checkout | 2–4 hours |
| Document persistent disk setup in `render-deploy-checklist.md` | Data loss on redeploy if disk not mounted | 30 min |
| Add Stripe webhook retry monitoring | Silent plan upgrade failures | Depends on Stripe Dashboard access |
| WAV/FLAC: fix Multer accept-list or add processor support | Bandwidth waste + user confusion | Medium effort |
| Email verification | Account security | Medium effort |
| ExifTool test fixtures + integration tests | Core product guarantee unverified | 1–2 days |

---

## Do not assume
- Do not assume CI is green — check the actual run status before reporting deploy state.
- Do not assume the Stripe webhook is delivering correctly — check the Stripe event log.
- Do not assume the production DB is on a persistent disk — verify the Render/Hyperlift disk configuration.
- Do not generate a "shipped" list from memory — use `git log` output or ask the founder.
- Do not omit known risks to make the review look clean — the point of this review is to surface real issues.
