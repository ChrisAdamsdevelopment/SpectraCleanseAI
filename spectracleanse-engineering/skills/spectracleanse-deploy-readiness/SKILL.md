# spectracleanse-deploy-readiness

**Use this skill before any production deploy to Render or Hyperlift.** This skill is conservative by design. It produces a checklist and go/no-go recommendation. It does not auto-deploy or modify any live environment.

---

## SpectraCleanse deployment model (confirmed from repo)

- **Runtime**: Node 20.20.2 (`.nvmrc`, `.node-version`). Render/Hyperlift must be pinned — set `NODE_VERSION=20.20.2` in the service environment if the platform defaults to a newer version. Node 24 is known-incompatible (`better-sqlite3` native compilation fails).
- **Start command**: `node server.js` (confirmed `package.json` `scripts.start`).
- **Build command**: `npm ci && tsc && vite build` (TypeScript compile + Vite frontend build). The CI workflow uses `npm ci` not `npm install`.
- **Static serving**: `server.js` serves `dist/` via `express.static` when it exists. Frontend must be built before deploy or the SPA will 404.
- **Database**: SQLite at `DB_PATH`. On Render, this must point to a persistent disk mount (e.g. `/data/spectra.db`). If `DB_PATH` is missing, the server falls back to `spectra.db` in the working directory — which is ephemeral on Render.
- **CORS**: If `NODE_ENV=production` and both `FRONTEND_URL` and `ALLOWED_ORIGINS` are empty, the server calls `process.exit(1)` at startup. This is a silent fail on Render if env vars are misconfigured.
- **Stripe**: All four Stripe vars must be set in production or the server exits at startup: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CREATOR_PRICE_ID`, `STRIPE_STUDIO_PRICE_ID`.
- **Frontend env var**: The frontend build reads `VITE_API_URL`. This must be set in the **build environment** (not just runtime). If missing in the build, the frontend will throw a runtime error: "Missing VITE_API_URL in production build."
- **CI**: GitHub Actions (`.github/workflows/ci.yml`) runs audit + smoke test on push to `main`. Node 18 is used in CI — note this diverges from the production pin of 20.20.2. ⚠️ Known discrepancy.
- **Hyperlift**: `deploy.md` documents Spaceship Hyperlift as a deployment target with `hyperlift.toml` present in the repo. The `.env.example` also references Render terminology. Both are valid deployment paths; this checklist covers both.

---

## Pre-deploy checklist

### Node runtime
- [ ] Render/Hyperlift service is pinned to Node 20.20.2 (`NODE_VERSION=20.20.2` in service env)
- [ ] `node --version` in build logs shows `v20.x.x`
- [ ] Not running Node 24 (better-sqlite3 incompatible)

### Build
- [ ] `npm ci` completes without errors
- [ ] `npm audit --audit-level=high` passes (mirrors CI gate)
- [ ] `tsc --noEmit` passes (TypeScript type check)
- [ ] `vite build` produces `dist/index.html` and `dist/assets/`
- [ ] `dist/` is present in the deploy artifact or built during deploy

### Environment variables — backend (Render/Hyperlift runtime)
- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` — set, non-empty, ≥32 chars random hex
- [ ] `STRIPE_SECRET_KEY` — starts with `sk_live_` (not `sk_test_` in prod)
- [ ] `STRIPE_WEBHOOK_SECRET` — starts with `whsec_`
- [ ] `STRIPE_CREATOR_PRICE_ID` — starts with `price_`
- [ ] `STRIPE_STUDIO_PRICE_ID` — starts with `price_` (different from Creator price)
- [ ] `GEMINI_API_KEY` — set and non-empty
- [ ] `FRONTEND_URL` — set to `https://spectracleanse.com` (no trailing slash)
- [ ] `DB_PATH` — set to path on persistent volume (e.g. `/data/spectra.db`)
- [ ] `PORT` — set to `3001` (or whatever Render/Hyperlift expects)
- [ ] `ENABLE_MOCK_CHECKOUT` — NOT set to `true` in production

### Environment variables — frontend (Vite build environment)
- [ ] `VITE_API_URL` — set to `https://api.spectracleanse.com` or the correct backend URL (⚠️ note: `.env.example` lists `VITE_BACKEND_URL` but `app.tsx` reads `VITE_API_URL` — use `VITE_API_URL`)
- [ ] This variable must be available at **build time**, not just runtime

### CORS and origins
- [ ] `FRONTEND_URL` and/or `ALLOWED_ORIGINS` covers the production frontend origin
- [ ] No wildcard (`*`) origins in production
- [ ] Stripe webhook endpoint (`/api/stripe-webhook`) is accessible from Stripe IPs (not CORS-blocked — Stripe uses server-to-server)

### Database persistence
- [ ] Render persistent disk is mounted at the path matching `DB_PATH`
- [ ] Disk persists across deploys and restarts (not ephemeral)
- [ ] `uploads/` directory is either on the persistent disk or is intentionally ephemeral (processed files are deleted immediately after download)

### Stripe configuration
- [ ] Stripe webhook is configured in the Stripe Dashboard to send `checkout.session.completed` and `customer.subscription.deleted` events
- [ ] Webhook endpoint URL is `https://[your-backend-domain]/api/stripe-webhook`
- [ ] Webhook signing secret matches `STRIPE_WEBHOOK_SECRET` env var
- [ ] Creator and Studio price IDs match active subscription products in Stripe Dashboard

---

## Smoke tests (run after deploy)

Run these against the live deployment, not localhost.

```bash
# 1. Health check
curl -sf https://api.spectracleanse.com/api/health
# Expected: {"status":"ok","time":"..."}

# 2. Unauthenticated /api/me → 401
curl -sf https://api.spectracleanse.com/api/me
# Expected: {"error":"Missing or malformed Authorization header"} with HTTP 401

# 3. Unknown API route → 404 JSON (not HTML)
curl -sf https://api.spectracleanse.com/api/nonexistent
# Expected: {"error":"API route not found","path":"/api/nonexistent"} with HTTP 404

# 4. Frontend SPA loads
curl -sf https://spectracleanse.com | grep -q "SpectraCleanse"
# Expected: HTML containing app content (not a blank page or 500)

# 5. Auth flow (manual)
# Register a new account → login → verify /api/me returns { user: { plan: 'free' }, usage: { thisMonth: 0 } }

# 6. Checkout smoke test (manual, use Stripe test mode for staging)
# Trigger upgrade flow → verify Stripe checkout session URL is returned

# 7. SEO generation smoke test (manual)
# POST /api/generate-seo with valid auth and payload → verify JSON response with title/description/tags

# 8. Upload smoke test (manual with .mp4 or .m4a test file)
# POST /api/process with valid auth and a test file → verify response headers X-Forensic-* are present

# 9. Unsupported format rejection (manual with .mp3 to /api/process)
# Expected: HTTP 422 with reason: "unsupported_file_type" and guidance to use Quick Cleanse
```

---

## Known risks

| Risk | Mitigation |
|---|---|
| `VITE_API_URL` missing from build env | Frontend throws at runtime on first API call. Set in Render build environment settings, not just runtime env. |
| Node version drift | CI uses Node 18; production runs Node 20.20.2. Confirm no `package-lock.json` inconsistency. |
| SQLite on ephemeral disk | All user accounts and jobs lost on redeploy. Verify persistent disk is mounted before go-live. |
| Stripe webhook mis-signed | All plan upgrades silently dropped. Verify `STRIPE_WEBHOOK_SECRET` matches Dashboard signing secret exactly. |
| ExifTool cold start | First request after deploy may be slow (ExifTool Perl subprocess boot). Not a blocking issue but monitor. |
| `uploads/` directory missing | Multer will fail on first upload. `fs.ensureDirSync('uploads')` in `server.js` handles this at startup. |

---

## Rollback plan

1. In Render/Hyperlift dashboard, identify the previous successful deploy.
2. Trigger a redeploy from the previous commit SHA.
3. Verify `/api/health` returns `{"status":"ok"}` within 60 seconds.
4. If the DB was migrated, restore from the most recent backup before rollback.
5. Notify affected users if auth or billing was impacted.

Note: SpectraCleanse currently has no automated DB migration system. Schema changes in `server.js` (the `db.exec(CREATE TABLE IF NOT EXISTS ...)` block) are additive and idempotent — safe to re-run. Destructive schema changes require a manual migration plan.

---

## Output format

```
## Release summary
[What's changing in this deploy]

## Pre-deploy checklist
[Completed checklist items — mark each ✅ or ❌ with notes]

## Env checklist
[All env vars verified ✅ or flagged ❌]

## Build checklist
[npm ci, tsc, vite build status]

## Smoke tests
[Results of each smoke test]

## Known risks
[Any risks specific to this release]

## Rollback plan
[Steps to revert if this deploy causes a regression]

## Go / No-Go
[GO if all blocking items are clear. NO-GO with explicit reason if any blocking item fails.]
```

---

## Do not assume
- Do not assume `VITE_BACKEND_URL` is the correct frontend env var — the code uses `VITE_API_URL`.
- Do not assume Node 18 compatibility from CI means Node 18 is the production target — production uses 20.20.2.
- Do not assume Render's default disk is persistent — it must be explicitly configured.
- Do not assume mock checkout is safe to leave enabled in production.
