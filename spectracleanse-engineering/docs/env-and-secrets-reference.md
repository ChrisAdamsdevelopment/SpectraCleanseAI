# SpectraCleanse – Environment Variables and Secrets Reference

All variables confirmed from `server.js` and `app.tsx` as of May 2026.
Do not store real values in this file. Use Render/Hyperlift dashboard secrets management.

---

## Backend variables (Node.js runtime — `server.js`)

### Core server

| Variable | Type | Required | Default (non-prod) | Description |
|---|---|---|---|---|
| `PORT` | number | No | `3001` | Port the Express server listens on. Render/Hyperlift typically assigns this. |
| `NODE_ENV` | string | Yes (prod) | — | Set to `production` in all production deployments. Controls dev-friendly fallbacks. |

### Auth

| Variable | Type | Required | Default (non-prod) | Description |
|---|---|---|---|---|
| `JWT_SECRET` | string | **Yes — server exits if missing in production** | `dev_jwt_secret_change_me` (dev only) | Signs and verifies JWT tokens. Must be a long random string (≥32 chars). Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`. Never reuse across environments. |

⚠️ **Rotating `JWT_SECRET`** invalidates all existing tokens — all logged-in users must re-login. Only rotate deliberately, never accidentally via deploy.

### Database

| Variable | Type | Required | Default (non-prod) | Description |
|---|---|---|---|---|
| `DB_PATH` | string | Yes | `spectra.db` (working dir) | Absolute path to the SQLite database file. In production on Render, must point to a persistent disk mount (e.g. `/data/spectra.db`). If missing or pointing to ephemeral storage, all user data is lost on redeploy. |

⚠️ **Render-specific**: Render web services have ephemeral local storage. You must add a persistent disk in the Render dashboard and set `DB_PATH` to a path within that disk's mount point. Hyperlift uses similar persistent volume configuration (`/data` per `deploy.md`).

### CORS and origins

| Variable | Type | Required | Default (non-prod) | Description |
|---|---|---|---|---|
| `FRONTEND_URL` | string | **Yes in production** | `''` | Full URL of the frontend (e.g. `https://spectracleanse.com`). Used to configure CORS allowed origins AND as the base URL for Stripe checkout `success_url`/`cancel_url`. No trailing slash. |
| `ALLOWED_ORIGINS` | string | No | `''` | Comma-separated list of additional allowed CORS origins. Useful if the frontend and backend are on different subdomains. Combined with `FRONTEND_URL`. |

⚠️ If both `FRONTEND_URL` and `ALLOWED_ORIGINS` are empty in production, the server calls `process.exit(1)` at startup — the deploy will silently fail.

### Stripe

| Variable | Type | Required | Default (non-prod) | Description |
|---|---|---|---|---|
| `STRIPE_SECRET_KEY` | string | **Yes in production** | — | Stripe secret key. Starts with `sk_live_` in production, `sk_test_` in test mode. Found in Stripe Dashboard → Developers → API keys. |
| `STRIPE_WEBHOOK_SECRET` | string | **Yes in production** | — | Stripe webhook signing secret. Starts with `whsec_`. Found in Stripe Dashboard → Developers → Webhooks → your endpoint → Signing secret. Must match the webhook URL exactly. |
| `STRIPE_CREATOR_PRICE_ID` | string | **Yes in production** | — | Stripe Price ID for the Creator plan ($9.99/mo). Starts with `price_`. Found in Stripe Dashboard → Products. |
| `STRIPE_STUDIO_PRICE_ID` | string | **Yes in production** | — | Stripe Price ID for the Studio plan ($29.99/mo). Starts with `price_`. Must be different from the Creator price ID. |
| `ENABLE_MOCK_CHECKOUT` | boolean | No | `false` | If `true`, `/api/create-checkout-session` returns a mock redirect without calling Stripe. Useful for local development without Stripe credentials. **Must never be `true` in production.** |

⚠️ If any of the four Stripe vars are missing in production (`NODE_ENV=production`), the server calls `process.exit(1)` at startup.

⚠️ **Stripe webhook ordering**: The `/api/stripe-webhook` route uses `express.raw({ type: 'application/json' })` and must be registered **before** `app.use(express.json())` in `server.js`. This is already correct in the current codebase — do not change this ordering.

### AI

| Variable | Type | Required | Default (non-prod) | Description |
|---|---|---|---|---|
| `GEMINI_API_KEY` | string | Yes (for SEO generation) | — | Google Gemini API key. Used by `/api/generate-seo` to call `gemini-2.5-flash`. Create at https://aistudio.google.com/app/apikey. If missing, `/api/generate-seo` returns HTTP 500. Processing (`/api/process`) does not depend on this key. |

---

## Frontend variables (Vite build-time — `app.tsx`)

⚠️ **These variables are embedded at build time by Vite.** They must be set in the build environment (Render build settings or CI env), not just as runtime env vars. Setting them only in Render's runtime env will have no effect.

| Variable | Type | Required | Build or Runtime | Description |
|---|---|---|---|---|
| `VITE_API_URL` | string | **Yes** | **Build time** | Base URL for all API calls from the frontend. Example: `https://api.spectracleanse.com`. If missing at build time, the frontend throws "Missing VITE_API_URL in production build" on first API call. |

⚠️ **Known discrepancy**: `.env.example` lists `VITE_BACKEND_URL` but `app.tsx` line 11 reads `VITE_API_URL`. The correct variable name is `VITE_API_URL`. The `.env.example` entry is incorrect and should be updated.

---

## Variable classification

| Variable | Secret? | Commit to repo? | Notes |
|---|---|---|---|
| `JWT_SECRET` | ✅ Secret | Never | Treat like a password |
| `STRIPE_SECRET_KEY` | ✅ Secret | Never | Live key gives billing access |
| `STRIPE_WEBHOOK_SECRET` | ✅ Secret | Never | Used to verify Stripe requests |
| `STRIPE_CREATOR_PRICE_ID` | ⚠️ Semi-sensitive | No | Price IDs are not strictly secret but should not be public |
| `STRIPE_STUDIO_PRICE_ID` | ⚠️ Semi-sensitive | No | Same as above |
| `GEMINI_API_KEY` | ✅ Secret | Never | API billing access |
| `DB_PATH` | ℹ️ Config | Safe in docs | Not secret but path leaks server layout |
| `FRONTEND_URL` | ℹ️ Config | Safe in docs | Public URL |
| `ALLOWED_ORIGINS` | ℹ️ Config | Safe in docs | Public URLs |
| `PORT` | ℹ️ Config | Safe in docs | |
| `NODE_ENV` | ℹ️ Config | Safe in docs | |
| `ENABLE_MOCK_CHECKOUT` | ℹ️ Config | Safe in docs | Must be false in prod |
| `VITE_API_URL` | ℹ️ Config | Safe in docs | Public URL embedded in bundle |

---

## Render-specific notes

- Set all secrets under **Environment → Secret Files or Environment Variables** in the Render dashboard.
- `VITE_API_URL` must be set under **Build** environment variables, not just runtime variables.
- `DB_PATH` must point to a path inside the persistent disk mount (e.g. `/data/spectra.db`). Add the disk under **Disks** in the Render service settings.
- `NODE_VERSION=20.20.2` should be set as a build environment variable to override Render's default Node version.
- `ENABLE_MOCK_CHECKOUT` must not be set (or must be `false`) on the production service.

---

## Local development (.env file)

Copy `.env.example` to `.env` and fill in values. Notes for local dev:
- `JWT_SECRET`: any non-empty string works locally
- Stripe: leave blank and set `ENABLE_MOCK_CHECKOUT=true` to use mock checkout
- `GEMINI_API_KEY`: required for SEO generation; use a real key or leave blank (SEO calls will return 500)
- `DB_PATH`: `./spectra.db` or `/tmp/spectra.db` for local development
- `FRONTEND_URL`: `http://localhost:5173`
- `VITE_API_URL`: set in your terminal or `.env` for Vite — e.g. `VITE_API_URL=http://localhost:3001`
