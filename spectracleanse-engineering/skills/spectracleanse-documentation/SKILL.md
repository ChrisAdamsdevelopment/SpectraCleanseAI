# spectracleanse-documentation

**Use this skill when writing or updating any SpectraCleanse documentation** — README, deployment guides, env var references, format support docs, billing/plan docs, API docs, release notes, or user-facing copy. Every doc produced by this skill must distinguish "currently supported" from "planned" and must be verified against actual code before making specific claims.

---

## SpectraCleanse context

SpectraCleanse has a small but real documentation footprint:
- `README.md` — product overview, pricing, deployment notes, Docker instructions
- `docs/manual-qa-checklist.md` — manual QA process covering local, API, auth, billing, upload, metadata, SEO, ExifTool, and Docker flows
- `deploy.md` — Spaceship Hyperlift deployment guide
- `PIPELINE.md` — GitHub Actions CI/CD pipeline documentation

Known accuracy issues to preserve (do not silently "fix" without flagging):
- `.env.example` lists `VITE_API_URL` but `app.tsx` reads `VITE_API_URL`. Any doc that references the frontend env var must use `VITE_API_URL` and note the discrepancy in `.env.example`.
- `README.md` says "drag in any MP3, WAV, FLAC, M4A, or MP4 file" in the marketing copy but the server only supports MP4 and M4A for Full Server Cleanse. Quick Cleanse handles MP3 browser-side. WAV/FLAC are rejected at the processor. This overclaim must be corrected in any updated README.
- `PIPELINE.md` documents CI using Node 18, but `.nvmrc` pins Node 20.20.2. Any deploy doc must reference Node 20.20.2 for production.

---

## Rules

1. **Never overclaim format support.** The only formats confirmed from `cleansePolicy.js`:
   - Quick Cleanse (browser): MP3 only
   - Full Server Cleanse: MP4, M4A only
   - WAV, FLAC: Multer-accepted but processor-rejected (422)

2. **Always distinguish current from planned.** Use these markers:
   - ✅ Currently supported (verified from code)
   - 🔄 In development (confirmed work in progress)
   - 📋 Planned (documented intent, not yet built)
   - ❌ Not supported

3. **Verify endpoint names from `server.js` before documenting.** Confirmed endpoints:
   - `GET /api/health`
   - `POST /api/register`
   - `POST /api/login`
   - `GET /api/me`
   - `POST /api/create-checkout-session`
   - `POST /api/stripe-webhook`
   - `POST /api/process`
   - `POST /api/process-batch`
   - `POST /api/generate-seo`
   - `GET /api/download/:token`

4. **Verify env var names before documenting.** Backend vars: `PORT`, `FRONTEND_URL`, `ALLOWED_ORIGINS`, `JWT_SECRET`, `DB_PATH`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CREATOR_PRICE_ID`, `STRIPE_STUDIO_PRICE_ID`, `ENABLE_MOCK_CHECKOUT`, `GEMINI_API_KEY`, `NODE_ENV`. Frontend build var: `VITE_API_URL` (not `VITE_API_URL`).

5. **Prefer clear user-facing language** over technical jargon in user docs. "Removes embedded tags that signal AI-generated origin" not "writes null to QuickTime atom fields."

6. **Always note when a behavior is dev-mode-only.** Mock checkout (`ENABLE_MOCK_CHECKOUT=true`) and the dev-only JWT fallback (`dev_jwt_secret_change_me`) must never appear in production docs as if they are production behavior.

---

## Document templates

### README update

Audience: developers and self-hosters discovering the project.
Must include: what the product does, how to run locally, required env vars, deployment notes, format support matrix (accurate), pricing, contact.
Must not include: fake endpoints, unsupported formats claimed as supported, production secrets, Node 18 as the target (it's 20.20.2).

### Deployment doc

Audience: engineer or founder setting up a new Render/Hyperlift deployment.
Must include: Node version pin (20.20.2), build command (`npm ci && tsc && vite build`), start command (`node server.js`), all required env vars, persistent disk configuration for SQLite, CORS setup, Stripe webhook registration, smoke test commands.
Must not include: `VITE_API_URL` (use `VITE_API_URL`), `ENABLE_MOCK_CHECKOUT=true` in production instructions.

### Env var reference

See `docs/env-and-secrets-reference.md` for the authoritative list with annotations.
When updating: verify each var exists and is actually read from `server.js` or `app.tsx`. Do not document vars from `.env.example` that are commented out or unused.

### Supported formats doc

See `docs/supported-formats-and-processing-boundaries.md` for the format matrix template.
Any claim about a specific format must be verifiable from `server/cleansePolicy.js`.

### API documentation

Audience: developers integrating or testing the API.
For each endpoint, document: method + path, auth requirement, request format, success response, error responses (with HTTP codes and reason fields).
Do not invent response fields — verify from `server.js`.

### Release notes

Format:
```
## v[X.Y.Z] – [date]
### Added
- [New feature — be specific about what changed and why]
### Changed
- [Behavior change — include what the old behavior was]
### Fixed
- [Bug fix — describe what was broken and what the user experienced]
### Known issues
- [Anything shipped with a known limitation]
```

### User-facing copy (upgrade modal, error messages, format rejection messages)

Current messages verified from `server.js`:
- Unsupported format: "Full Server Cleanse currently supports MP4 and M4A only. Use Quick Cleanse (Browser) for MP3, or convert WAV/FLAC to M4A/MP4."
- Free tier limit: "Free accounts are limited to 3 files per month. Upgrade to continue processing."
- Batch restriction: "Batch processing requires Creator or Studio plan."
- File too large: "File too large (max 500MB)"

When updating user-facing messages, ensure the `server.js` error response text and the frontend modal/banner copy stay in sync.

### Trust / privacy explanation

What to cover: what metadata is removed (all ExifTool-readable tags except those in `isBenign()` and `isAllowedInjected()`), what is injected (user-supplied metadata via `buildMetaToWrite()`), how long files are retained (deleted after download), what is stored in the DB (filename, user_id, platform, created_at — no file content), and how provenance markers are detected (MARKER_RULES in `server/metadataRules.js`).

---

## Checklist

- [ ] Have format claims been verified from `server/cleansePolicy.js`?
- [ ] Have endpoint names been verified from `server.js`?
- [ ] Have env var names been verified from `server.js` and `app.tsx`?
- [ ] Does the doc distinguish currently supported from planned?
- [ ] Is `VITE_API_URL` used (not `VITE_API_URL`) where the frontend env var is mentioned?
- [ ] Is Node 20.20.2 referenced as the production target (not Node 18)?
- [ ] Is mock checkout described as dev-only?
- [ ] Is the format support matrix accurate (MP3=Quick Cleanse only, MP4/M4A=Server Cleanse, WAV/FLAC=rejected)?
- [ ] Are all pricing figures current ($9.99 Creator, $29.99 Studio, 3 files/month free)?

---

## Output format

```
## Target doc
[Which document is being created or updated]

## Audience
[Who will read this: developer, user, self-hoster, founder]

## Current facts (from code)
[Verified facts that the doc must reflect]

## Draft content
[The actual documentation content]

## Accuracy notes
[Any claim that required code verification, and what was found]

## Follow-up verification needed
[Any claim that could not be verified from available code and must be checked before publishing]
```

---

## Do not assume
- Do not claim WAV or FLAC are supported by Full Server Cleanse.
- Do not use `VITE_API_URL` as the frontend env var — the code reads `VITE_API_URL`.
- Do not document Node 18 as the production runtime target.
- Do not document features as "current" if they are not confirmed in the codebase (e.g., email verification, password reset, OAuth).
- Do not document the Stripe webhook path as anything other than `/api/stripe-webhook`.
