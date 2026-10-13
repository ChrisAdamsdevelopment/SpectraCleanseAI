# SpectraCleanse AI

**Engineering portfolio:** [Full-stack architecture, AI integration, media-processing pipelines, QA and release constraints](docs/engineering-portfolio.md).

**Project stage:** web app and active engineering development; test the live deployment separately before relying on its availability.

**SpectraCleanse AI is a full-stack audio/video metadata analysis and editing application, including embedded provenance-related metadata removal and AI-assisted descriptive metadata generation.**

Upload a supported audio or video file, choose a processing mode, inspect the detected metadata, optionally remove supported embedded fields, and obtain Gemini-generated title/description/tag suggestions. Supported file types and modes are listed below. Removing metadata is not a guarantee that all provenance information disappears or that a distribution platform will rank content differently.

---

## Try it free

→ **[spectracleanse.com](https://spectracleanse.com)**

Account and billing options are described in the application; confirm current plans and limits there before purchasing.

---

## How it works

1. **Upload** — Quick Cleanse supports MP3 (browser-side). Full Server Cleanse supports MP4 and M4A (server-side). WAV and FLAC are planned but not currently supported.
2. **Analyse** — the application inspects supported embedded metadata fields and flags those it can identify.
3. **Cleanse** — supported editing pathways remove selected embedded metadata fields; exact results depend on file format and processing mode.
4. **Suggest metadata** — Gemini generates proposed descriptive titles, descriptions and tags for the chosen platform; optimization outcomes are not guaranteed.
5. **Download** — receive the processed file and a report of detected and modified fields for the supported processing mode.

---

## Open source

The source code is available at [github.com/ChrisAdamsdevelopment/SpectraCleanseAI](https://github.com/ChrisAdamsdevelopment/SpectraCleanseAI) and is released under the [MIT License](LICENSE). You are free to self-host, fork, or contribute.

---

## Local development notes

- Backend defaults to developer-friendly mode when `NODE_ENV` is not `production`.
- If Stripe env vars are missing locally, `/api/create-checkout-session` can return a mock checkout redirect (set `ENABLE_MOCK_CHECKOUT=true`).
- In production, Stripe variables are still required and the server will fail fast if they are missing.

---

## Product direction docs

- [Product Definition: Song-Centered Artist Content Studio](docs/PRODUCT_DEFINITION_SONG_CONTENT_STUDIO.md)
- [Architecture Spike: Song-Centered Artist Content Studio](docs/ARCHITECTURE_SPIKE_SONG_CONTENT_STUDIO.md)

## QA / Deployment Testing

For a step-by-step manual validation flow (local, API smoke, auth, billing, upload, cleanse, Docker, and production readiness), see [`docs/manual-qa-checklist.md`](docs/manual-qa-checklist.md).

- Browser metadata analysis uses maintained `music-metadata` with graceful fallback (`parseError`) when parsing fails, times out, or is skipped for very large files.
- Quick Cleanse metadata writing remains local/browser-side (MP3 via `browser-id3-writer`).
- Full Server Cleanse runs through `/api/process`; MP3 requests are rejected with HTTP `422`. Full Server Cleanse currently supports MP4/M4A only; WAV/FLAC are planned but not currently supported.

---

## Contact

Questions, partnerships, or enterprise enquiries: [hello@spectracleanse.com](mailto:hello@spectracleanse.com)

---

## Native Node deployment runtime

- Native Render/Node deployments should use **Node 20.20.2** (recommended) or another **Node 20.x** release.
- If Render defaults your service to a newer Node release, set `NODE_VERSION=20.20.2` in the service environment.
- Node 24 is currently not supported for native installs in validation because `better-sqlite3` native compilation failed under Node 24.
- Docker deployments already pin Node 20 via the repo Dockerfile.

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

## Health & observability

- `GET /api/health` (public, no auth) returns `{ status, uptime, version, time }`. Useful for uptime monitors and Render health checks.
- `GET /sitemap.xml` and `GET /robots.txt` are served directly by the backend so they work without the SPA static build (e.g. during dev) and stay in sync with the canonical domain `https://spectracleanse.com`.

## Rate limiting

- All `/api/*` routes (except `/api/health` and the Stripe webhook) are gated by a 60-requests-per-minute-per-IP limiter.
- `/api/login`, `/api/register`, and the `/api/auth/*` routes get a tighter 10/min limiter on top to make brute-force harder.
- A throttled request returns `429` with `{ "error": "Too many requests" }`.

## Batch processing API

- `POST /api/process-batch` (authenticated): processes up to 20 uploaded files sequentially for paid plans (Creator/Studio). Free plan returns `403`.
- `GET /api/download/:token` (authenticated): one-time secure download for batch outputs.
- MP3 server cleanse remains unsupported (`422` for single process, per-file error in batch); use Quick Cleanse Browser for MP3. Full Server Cleanse currently supports MP4/M4A only; WAV/FLAC are planned but not currently supported.
- Batch requests enforce a 2GB post-upload soft guard; production deployments should still enforce proxy/body-size/disk limits.
