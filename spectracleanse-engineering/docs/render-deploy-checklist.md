# SpectraCleanse Render / Hyperlift Deploy Checklist

Use this checklist before every production deploy. Complete every item and note ✅ or ❌.

This checklist covers both Render (web service) and Spaceship Hyperlift (both documented in the repo). Note which platform you're deploying to.

---

## Platform: [Render / Hyperlift — fill in]
## Deploy date: [date]
## Commit SHA: [sha]
## Changes in this deploy: [brief summary]

---

## 1. Node version

- [ ] Service is pinned to Node 20.20.2 (`NODE_VERSION=20.20.2` in service environment)
- [ ] Not Node 24 (better-sqlite3 native compilation incompatible)
- [ ] Build log confirms `v20.x.x` — not `v18.x.x` or `v24.x.x`

Note: `.github/workflows/ci.yml` uses Node 18 for CI. This diverges from the production pin. Do not use CI's Node version as a guide for the production runtime.

---

## 2. Build commands

- [ ] `npm ci` (not `npm install`) — ensures lockfile is respected
- [ ] `tsc --noEmit` passes — no TypeScript errors
- [ ] `vite build` succeeds — `dist/index.html` and `dist/assets/` are present
- [ ] `npm audit --audit-level=high` passes (run locally before push if CI hasn't run yet)

Start command: `node server.js` (confirmed `package.json` `scripts.start`).

---

## 3. Backend environment variables (Render/Hyperlift runtime)

All of these must be set as secrets or env vars in the Render/Hyperlift dashboard. Never hardcode.

| Variable | Required | Check |
|---|---|---|
| `NODE_ENV` | ✅ must be `production` | [ ] |
| `JWT_SECRET` | ✅ non-empty, ≥32 chars random hex | [ ] |
| `STRIPE_SECRET_KEY` | ✅ starts with `sk_live_` in production | [ ] |
| `STRIPE_WEBHOOK_SECRET` | ✅ starts with `whsec_` | [ ] |
| `STRIPE_CREATOR_PRICE_ID` | ✅ starts with `price_` | [ ] |
| `STRIPE_STUDIO_PRICE_ID` | ✅ starts with `price_`, different from Creator | [ ] |
| `GEMINI_API_KEY` | ✅ non-empty | [ ] |
| `FRONTEND_URL` | ✅ `https://spectracleanse.com` (no trailing slash) | [ ] |
| `DB_PATH` | ✅ path on persistent volume, e.g. `/data/spectra.db` | [ ] |
| `PORT` | ✅ `3001` (or platform-expected port) | [ ] |
| `ENABLE_MOCK_CHECKOUT` | ❌ must NOT be `true` in production | [ ] |
| `ALLOWED_ORIGINS` | Optional — use if frontend and backend are on separate domains | [ ] |

---

## 4. Frontend build environment variables (must be set at build time)

⚠️ These are Vite variables — they must be available when `vite build` runs, not at runtime.

| Variable | Value | Check |
|---|---|---|
| `VITE_API_URL` | `https://api.spectracleanse.com` (or your actual backend URL) | [ ] |

**Critical**: The frontend reads `VITE_API_URL` (confirmed in `app.tsx` line 11), and `.env.example` is aligned. Do not use `legacy backend env var`. If `VITE_API_URL` is missing at build time, the frontend will throw "Missing VITE_API_URL in production build" on first load.

---

## 5. CORS configuration

- [ ] `FRONTEND_URL` matches the exact origin the browser sends (no trailing slash, correct scheme)
- [ ] If frontend and backend are on different domains, `ALLOWED_ORIGINS` also covers the frontend origin
- [ ] No wildcard (`*`) CORS in production
- [ ] Confirm in browser devtools: `Access-Control-Allow-Origin: https://spectracleanse.com` in response headers

If both `FRONTEND_URL` and `ALLOWED_ORIGINS` are empty in production, the server calls `process.exit(1)` at startup — the service will appear to crash on deploy.

---

## 6. Database and persistence

- [ ] Render/Hyperlift persistent disk is configured and mounted at the `DB_PATH` path
- [ ] Disk persists across deploys and service restarts
- [ ] `DB_PATH` env var matches the mount path exactly (e.g. `DB_PATH=/data/spectra.db` with disk at `/data`)
- [ ] If this is a fresh deploy, the DB will be created automatically by `db.exec(CREATE TABLE IF NOT EXISTS ...)` — no manual migration needed for the current schema
- [ ] Confirm the existing `spectra.db` file is not being overwritten by a fresh deploy

⚠️ If the disk is not mounted and `DB_PATH` points to the working directory, the DB is ephemeral — all user accounts and jobs are lost on every redeploy. This is a critical data-loss risk.

---

## 7. Stripe configuration

- [ ] Stripe webhook is registered in Stripe Dashboard → Developers → Webhooks
- [ ] Webhook URL: `https://[backend-domain]/api/stripe-webhook`
- [ ] Webhook events: `checkout.session.completed`, `customer.subscription.deleted`
- [ ] Webhook signing secret matches `STRIPE_WEBHOOK_SECRET` env var exactly
- [ ] `STRIPE_CREATOR_PRICE_ID` and `STRIPE_STUDIO_PRICE_ID` match active products in Stripe Dashboard
- [ ] Using live-mode keys (`sk_live_`, `whsec_`) not test-mode keys in production

---

## 8. Smoke tests (run against live deployment after deploy completes)

```bash
# Set your backend URL
BACKEND=https://api.spectracleanse.com
FRONTEND=https://spectracleanse.com

# 1. Health check
curl -sf $BACKEND/api/health
# Expected: {"status":"ok","time":"..."}

# 2. Unauthenticated /api/me → 401
curl -o /dev/null -w "%{http_code}" $BACKEND/api/me
# Expected: 401

# 3. Unknown API route → 404 JSON
curl -sf $BACKEND/api/nonexistent
# Expected: {"error":"API route not found",...}

# 4. Frontend loads
curl -sf $FRONTEND | grep -q "SpectraCleanse"
# Expected: success (HTML with app content, not blank or 500)
```

**Manual smoke tests** (from `docs/manual-qa-checklist.md`):
- [ ] Register a new user
- [ ] Login with that user
- [ ] `/api/me` returns `{ plan: 'free', usage: { thisMonth: 0, limit: 3 } }`
- [ ] Trigger checkout flow → verify Stripe Checkout URL returned (not mock URL)
- [ ] Upload a `.mp4` test file → verify download succeeds + `X-Forensic-Removed` header present
- [ ] Upload a `.mp3` to `/api/process` → verify 422 with correct guidance message
- [ ] Trigger `/api/generate-seo` with title + artist → verify JSON with `title`, `description`, `tags`

---

## 9. Go / No-Go

| Gate | Status |
|---|---|
| Node 20.20.2 pinned | ✅ / ❌ |
| Build passes (tsc + vite) | ✅ / ❌ |
| All required env vars set | ✅ / ❌ |
| `VITE_API_URL` in build env | ✅ / ❌ |
| CORS origins correct | ✅ / ❌ |
| Persistent disk mounted | ✅ / ❌ |
| Stripe configured with live keys | ✅ / ❌ |
| `/api/health` returns 200 | ✅ / ❌ |
| Auth smoke test passes | ✅ / ❌ |

**GO** only if all gates are ✅.

---

## Rollback procedure

1. In Render/Hyperlift dashboard → navigate to the service → Deployments
2. Find the last successful deploy SHA
3. Click "Redeploy" on that SHA
4. Wait for `/api/health` to return `{"status":"ok"}`
5. If DB schema was changed in the failed deploy: assess whether the rollback is safe (all schema changes in current codebase are additive/idempotent — `CREATE TABLE IF NOT EXISTS`)
6. Communicate to users if auth, billing, or processing was impacted
