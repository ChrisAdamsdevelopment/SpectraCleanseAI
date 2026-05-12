# SpectraCleanse AI

![Live](https://img.shields.io/badge/status-live-brightgreen)
![Pricing](https://img.shields.io/badge/pricing-free%20%7C%20%249.99%20%7C%20%2424.99-blue)
![Sign up](https://img.shields.io/badge/sign%20up-spectracleanse.com-cyan)

**SpectraCleanse AI strips AI provenance markers and injects SEO metadata to beat algorithmic suppression.**

Upload your audio or video file, choose a platform preset, and SpectraCleanse AI will forensically wipe every embedded tag that signals AI-generated origin — then inject clean, platform-optimised metadata powered by Gemini to maximise your reach on YouTube, Spotify, Apple Music, TikTok, and beyond.

---

## Try it free

→ **[spectracleanse.com](https://spectracleanse.com)**

No credit card required. Free accounts include 3 files per month. Upgrade to Creator ($9.99/mo) or Studio ($24.99/mo) for unlimited processing and batch uploads.

---

## How it works

1. **Upload** — drag in any MP3, WAV, FLAC, M4A, or MP4 file (up to 500 MB).
2. **Analyse** — the forensic engine reads every embedded tag and identifies provenance markers.
3. **Cleanse** — a nuclear wipe removes all XMP, IPTC, and ID3 fields that could trigger algorithmic detection.
4. **Inject** — Gemini generates an SEO-optimised title, description, and tag set tuned to your chosen platform.
5. **Download** — receive a clean file with a full forensic report showing exactly what was removed.

---

## Open source

The source code is available at [github.com/ChrisAdamsdevelopment/SpectraCleanseAI](https://github.com/ChrisAdamsdevelopment/SpectraCleanseAI) and is released under the [MIT License](LICENSE). You are free to self-host, fork, or contribute.

---

## Local development notes

- Backend defaults to developer-friendly mode when `NODE_ENV` is not `production`.
- If Stripe env vars are missing locally, `/api/create-checkout-session` can return a mock checkout redirect (set `ENABLE_MOCK_CHECKOUT=true`).
- In production, Stripe variables are still required and the server will fail fast if they are missing.

---

## QA / Deployment Testing

For a step-by-step manual validation flow (local, API smoke, auth, billing, upload, cleanse, Docker, and production readiness), see [`docs/manual-qa-checklist.md`](docs/manual-qa-checklist.md).

- Browser metadata analysis uses maintained `music-metadata` with graceful fallback (`parseError`) when parsing fails, times out, or is skipped for very large files.
- Quick Cleanse metadata writing remains local/browser-side (MP3 via `browser-id3-writer`).
- Full Server Cleanse runs through `/api/process` for supported non-MP3 formats; MP3 requests are rejected with HTTP `422` and guidance to use Quick Cleanse Browser.

---

## Contact

Questions, partnerships, or enterprise enquiries: [hello@spectracleanse.com](mailto:hello@spectracleanse.com)

---


## Native Node deployment runtime

- Native Render/Node deployments should use **Node 20.20.2** (recommended) or a Node version within the supported engines range: `>=18 <23`.
- If Render defaults your service to a newer Node release, set `NODE_VERSION=20.20.2` in the service environment.
- Node 24 is currently not supported for native installs in validation because `better-sqlite3` native compilation failed under Node 24.
- Docker deployments already pin Node 18 via the repo Dockerfile.

---

## Docker production deployment

This repository includes a multi-stage `Dockerfile` that builds the frontend and packages `dist/` into the final runtime image so `server.js` can serve the SPA in production.

### Build image

```bash
docker build -t spectracleanseai:latest .
```

### Run container

```bash
docker run --rm -p 3001:3001 \
  -e NODE_ENV=production \
  -e JWT_SECRET=your_jwt_secret \
  -e STRIPE_SECRET_KEY=sk_live_xxx \
  -e STRIPE_WEBHOOK_SECRET=whsec_xxx \
  -e STRIPE_CREATOR_PRICE_ID=price_xxx \
  -e STRIPE_STUDIO_PRICE_ID=price_xxx \
  -e GEMINI_API_KEY=your_gemini_api_key \
  -e FRONTEND_URL=https://your-frontend-domain.example \
  -e DB_PATH=/data/spectra.db \
  -v spectracleanse_data:/data \
  spectracleanseai:latest
```

### Required production environment variables

- `NODE_ENV=production`
- `JWT_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CREATOR_PRICE_ID`
- `STRIPE_STUDIO_PRICE_ID`
- `GEMINI_API_KEY`
- `FRONTEND_URL`
- `DB_PATH`
- `REDIS_URL` (only if your deployment still uses Redis externally)

### Stripe vs local mock checkout

- Local development may use `ENABLE_MOCK_CHECKOUT=true` when Stripe variables are not set.
- Production must use real Stripe configuration; do not rely on mock checkout in production.

Never commit real secrets to source control.
