# SpectraCleanse AI – Deployment Pipeline

## Overview

Your deployment pipeline is now automated from development through production. This includes:

- **Local development** with hot reload (`docker compose watch`)
- **PR validation** with security scanning, type-checking, and smoke tests
- **Automated builds** to Docker Hub
- **Staging environment** for testing before production
- **Production deployment** to Hyperlift with zero-downtime rolling updates

---

## Getting Started

### Local Development

Run the entire stack with hot reload (backend + database):

```bash
# First time setup: copy environment template
cp .env.example .env

# Start everything with live reload
bash dev.sh
# or manually:
docker compose up --pull=missing --watch --build
```

The `docker-compose.yml` uses `develop.watch` to sync code changes without rebuilding:
- Backend code changes (`src/`, `server.js`) sync in ~1s
- Package changes trigger a rebuild
- Database persists in a Docker volume (`spectra-data`)

**Access:**
- Backend: http://localhost:3001
- Frontend: http://localhost:5173 (run `npm run dev:frontend` separately)
- API health: http://localhost:3001/api/health

### Pre-Production Test

Before pushing to main, simulate production locally:

```bash
bash test-prod.sh
```

This builds your exact production image and validates the startup sequence.

---

## GitHub Actions Workflows

### 1. CI/CD Pipeline (`.github/workflows/ci-cd.yml`)

Runs on **every push and PR** to `main` or `develop`.

#### Stage 1: Security & Audit
- Runs `npm audit` (moderate level)
- Scans for committed secrets with TruffleHog
- Fails fast if high-risk vulnerabilities found

#### Stage 2: Backend Validation (after security passes)
- Type-checks TypeScript (`tsc --noEmit`)
- Runs smoke test: starts server and validates `/api/health` endpoint
- Caches npm dependencies for faster builds

#### Stage 3: Frontend Validation (after security passes)
- Type-checks all React/TypeScript
- Builds production bundle (`vite build`)
- Uploads `dist/` artifact (retained 3 days for debugging)

#### Stage 4: Docker Build (after backend + frontend pass)
- Builds production image with layer caching
- **On main branch only:** pushes to Docker Hub with tags:
  - `latest` (always points to main)
  - `<branch>-<short-sha>` (for rollback traceability)
  - Semantic versions (if tags follow `v*.*.*`)
- **On PRs:** builds locally only (no push)

#### Stage 5: Deploy to Hyperlift (only main branch, if build succeeds)
- Calls your `HYPERLIFT_DEPLOY_HOOK` webhook
- Passes commit SHA for automatic image selection
- Hyperlift watches the image tag and redeploys automatically

### 2. Staging Validation (`.github/workflows/staging.yml`)

Runs **after CI/CD passes on `develop` branch**.

- Builds and pushes staging-specific image tags
- Calls `STAGING_DEPLOY_HOOK` if configured
- Runs smoke tests against staging environment
- Gives you a safe testing ground before merging to main

### 3. (Deprecated) Other Workflows

Your old workflows (`ci.yml`, `cd.yml`, `docker-image.yml`) are replaced by the new unified pipeline. You can delete them to avoid confusion.

---

## Required GitHub Secrets

Add these repository secrets in **Settings → Secrets and variables → Repository secrets**:

| Secret | Value |
|--------|-------|
| `DOCKERHUB_USERNAME` | Your Docker Hub username |
| `DOCKERHUB_TOKEN` | Docker Hub access token (not password) |
| `HYPERLIFT_DEPLOY_HOOK` | Webhook URL from Hyperlift dashboard |
| `STAGING_DEPLOY_HOOK` | (Optional) Staging webhook URL |
| `STAGING_URL` | (Optional) Staging base URL for health checks |

### Generating Docker Hub Token

1. Log in to [hub.docker.com](https://hub.docker.com)
2. Click your profile → Account Settings → Security → Personal access tokens
3. Click "Generate new token" → give it read/write permissions
4. Copy the token and add it to GitHub Secrets as `DOCKERHUB_TOKEN`

---

## Deployment Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Developer: git push to main or develop                      │
└────────────────┬────────────────────────────────────────────┘
                 │
         ┌───────▼────────┐
         │ Security Scan  │
         │ (TruffleHog)   │
         └───────┬────────┘
                 │
    ┌────────────┴────────────┐
    │                         │
┌───▼──────────┐    ┌────────▼─────┐
│ Backend Test │    │ Frontend Build│
│ (TypeScript) │    │ (Vite)        │
└───┬──────────┘    └────────┬─────┘
    │                         │
    └────────────┬────────────┘
                 │
    ┌────────────▼────────────┐
    │ Docker Build & Push     │
    │ (to Docker Hub)         │
    └────────────┬────────────┘
                 │
        ┌────────▼─────────┐
        │ Hyperlift Deploy │
        │ (main only)      │
        └──────────────────┘
```

### What Happens on Each Branch

**main branch:**
- ✅ All tests pass
- ✅ Docker image builds and pushes to `<user>/spectracleanse-api:latest`
- ✅ Hyperlift automatically redeploys (watches image tag)
- ✅ Zero-downtime rolling update (Medium plan+)

**develop branch:**
- ✅ All tests pass
- ✅ Docker image builds and pushes to `<user>/spectracleanse-api:staging-latest`
- ✅ Staging deployment triggered (if webhook configured)
- ⏸ Waiting for manual promotion to main

**PR branches:**
- ✅ All tests pass
- ✅ Docker image builds locally (no push)
- ⏸ Blocked from merging if tests fail
- 🔄 Review required before merge

---

## Environment Variables

### Local Development (`.env`)

Copy from `.env.example` and update:

```bash
cp .env.example .env
# Edit .env with your local values
```

The `dev.sh` script loads `.env` automatically. Missing vars use safe defaults.

### Hyperlift Production

Set these in Hyperlift Dashboard → Project Settings → Environment Variables:

**Secrets (encrypted at rest):**
- `JWT_SECRET` → Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`
- `STRIPE_SECRET_KEY` → From Stripe Dashboard
- `STRIPE_WEBHOOK_SECRET` → From Stripe Webhooks
- `STRIPE_CREATOR_PRICE_ID` → From Stripe Products
- `STRIPE_STUDIO_PRICE_ID` → From Stripe Products
- `GEMINI_API_KEY` → From Google AI Studio

**Non-secrets:**
- `PORT` = `3001`
- `NODE_ENV` = `production`
- `FRONTEND_URL` = `https://spectracleanse.com`
- `DB_PATH` = `/data/spectra.db`

### Volumes

Create a persistent volume in Hyperlift (at least 10 GB) mounted at `/data`. This is where SQLite database lives.

---

## Monitoring & Rollback

### Health Checks

All deployments validate the `/api/health` endpoint:

```bash
curl https://spectracleanse.com/api/health
# Response: {"status":"ok"}
```

If health checks fail for 3 consecutive intervals (30s default), Hyperlift stops the deployment.

### Logs

```bash
# Local development
docker compose logs -f app

# Production (via Hyperlift)
# Dashboard → Service → Logs tab
```

### Rollback

If production fails:

1. **Quick rollback:** In Hyperlift dashboard, click "Redeploy" with a previous image tag
2. **Full rollback:** Push a revert commit to main, wait for CI/CD to rebuild and redeploy
3. **Emergency stop:** In Hyperlift, click "Stop service" to halt traffic

---

## Performance Tuning

### Docker Build Cache

The pipeline uses GitHub Actions cache to skip redundant builds:

- First build: ~2 minutes (installs all deps)
- Subsequent builds: ~30 seconds (uses cache layers)

To clear cache:
1. In Hyperlift, click "Clear cache" before deploying
2. Or re-run GitHub Actions workflow with cache disabled

### Database Optimization

SQLite lives at `/data/spectra.db` in Hyperlift. For large deployments:

```sql
-- Run periodically from inside the container
PRAGMA optimize;
VACUUM;
```

Or upgrade to PostgreSQL for high-concurrency workloads.

---

## Troubleshooting

### Build Fails Locally

```bash
# Clear Docker cache and rebuild
docker system prune -a
bash dev.sh

# Or rebuild without cache
docker compose build --no-cache
```

### Container Exits Immediately

```bash
# Check logs
docker compose logs app

# Common issues:
# - Missing .env (copy from .env.example)
# - Port 3001 already in use (change in docker-compose.yml)
# - Database permission error (ensure /data volume exists)
```

### Health Check Failing on Hyperlift

```bash
# SSH into Hyperlift container and test manually
# Dashboard → Terminal tab
curl http://localhost:3001/api/health

# Check server logs
tail -f /data/spectra.log
```

### GitHub Actions Secrets Not Working

- Verify secret names match exactly (case-sensitive)
- Regenerate Docker Hub token (old ones expire)
- Ensure webhook URLs are correct

---

## Next Steps

1. **Test locally:** `bash dev.sh` and verify http://localhost:3001/api/health
2. **Update secrets:** Add `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `HYPERLIFT_DEPLOY_HOOK` to GitHub
3. **Merge this PR** to enable automated CI/CD
4. **Push to main** to trigger first production deployment
5. **Monitor:** Check Hyperlift logs for any deployment issues

---

## File Summary

| File | Purpose |
|------|---------|
| `.github/workflows/ci-cd.yml` | Main pipeline (security → test → build → deploy) |
| `.github/workflows/staging.yml` | Staging validation (develop → staging) |
| `docker-compose.yml` | Local dev with hot reload |
| `dev.sh` | Start development environment |
| `test-prod.sh` | Validate production build locally |
| `.dockerignore` | Optimized Docker builds (exclude unnecessary files) |

---

Sources:
- https://docs.docker.com/build/ci/github-actions/
- https://docs.docker.com/compose/
- https://docs.docker.com/reference/dockerfile/
- https://docs.docker.com/build/cache/
