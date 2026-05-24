# SpectraCleanse – Product and Engineering Context

This document is the reference for all plugin skills. It reflects facts confirmed from the repo as of May 2026. Mark any item you update with the date of change.

---

## What SpectraCleanse does

SpectraCleanse AI strips AI-provenance markers from audio and video files, then injects SEO-optimized metadata to help files perform well on algorithmic platforms (YouTube, Spotify, Apple Music, TikTok). 

Core value: removes embedded tags that signal AI-generated origin ("nuclear wipe"), then re-injects clean, platform-tuned metadata powered by Google Gemini.

---

## Architecture overview

```
Browser (React SPA, app.tsx)
        │
        │ HTTPS (VITE_API_URL)
        ▼
Node.js / Express (server.js, port 3001)
        │
        ├── Auth:        bcrypt + JWT (7d), no email verification
        ├── Billing:     Stripe subscription checkout + webhook
        ├── Upload:      Multer → uploads/ (ephemeral)
        ├── Processing:  ExifTool (exiftool-vendored, via server/processor.js)
        ├── SEO:         Google Gemini gemini-2.5-flash REST API
        ├── DB:          SQLite (better-sqlite3, WAL mode, DB_PATH)
        └── Static:      Vite-built dist/ served via express.static
```

---

## Confirmed stack (verified from package.json, server.js, app.tsx)

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Frontend framework | React | 18.3.1 | Single-file app.tsx |
| Frontend build | Vite | 4.5.14 | TypeScript 5.5.2 |
| Frontend styling | Tailwind CSS | 3.4.4 | postcss + autoprefixer |
| Frontend icons | lucide-react | 0.390.0 | |
| Backend runtime | Node.js | 20.20.2 | Pinned in .nvmrc; Node 24 incompatible |
| Backend framework | Express | 4.19.2 | |
| Database | better-sqlite3 | 9.6.0 | WAL mode, FK enforcement |
| Media analysis (browser) | music-metadata | 11.12.3 | Graceful parseError fallback |
| MP3 write (browser) | browser-id3-writer | 4.4.0 | Quick Cleanse only |
| Media processing (server) | exiftool-vendored | 28.3.1 | Wraps ExifTool Perl CLI |
| AI metadata gen | Google Gemini | gemini-2.5-flash | REST API (not SDK), structured JSON output |
| Auth | jsonwebtoken + bcryptjs | jwt 9.0.2, bcrypt 2.4.3 | 7d JWT, bcrypt cost 12 |
| Billing | stripe | 16.2.0 | Subscription checkout, webhook |
| File upload | multer | 2.0.0 | dest: uploads/, 500MB limit |
| File utils | fs-extra | 11.2.0 | |

---

## Confirmed API endpoints

All endpoints confirmed present in `server.js`:

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | /api/health | No | Returns `{"status":"ok","time":"..."}` |
| POST | /api/register | No | Email/password registration |
| POST | /api/login | No | Email/password login |
| GET | /api/me | Bearer JWT | Live plan + usage |
| POST | /api/create-checkout-session | Bearer JWT | Stripe checkout session |
| POST | /api/stripe-webhook | Stripe signature | Handles plan upgrades/downgrades |
| POST | /api/process | Bearer JWT, multipart | Single-file server cleanse |
| POST | /api/process-batch | Bearer JWT, multipart | Multi-file batch (paid plans, max 20) |
| POST | /api/generate-seo | Bearer JWT | Gemini SEO metadata generation |
| GET | /api/download/:token | Bearer JWT | One-time batch output download |

---

## Confirmed environment variables

See `docs/env-and-secrets-reference.md` for full descriptions and Render notes.

**Backend (runtime)**:
`PORT`, `NODE_ENV`, `FRONTEND_URL`, `ALLOWED_ORIGINS`, `JWT_SECRET`, `DB_PATH`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CREATOR_PRICE_ID`, `STRIPE_STUDIO_PRICE_ID`,
`ENABLE_MOCK_CHECKOUT`, `GEMINI_API_KEY`

**Frontend (build-time)**:
`VITE_API_URL` ← confirmed from `app.tsx` line 11. Note: `.env.example` lists `VITE_API_URL` — this is an **inaccuracy in .env.example**. The correct variable is `VITE_API_URL`.

---

## Format support (confirmed from server/cleansePolicy.js)

| Format | Quick Cleanse (browser) | Full Server Cleanse | Notes |
|---|---|---|---|
| MP3 | ✅ | ❌ 422 | Browser: browser-id3-writer. Server: rejected. |
| MP4 | ❌ | ✅ | Server-side ExifTool |
| M4A | ❌ | ✅ | Server-side ExifTool |
| WAV | ❌ | ❌ 422 | Multer accepts, processor rejects |
| FLAC | ❌ | ❌ 422 | Multer accepts, processor rejects |

⚠️ README.md currently claims "drag in any MP3, WAV, FLAC, M4A, or MP4 file" in marketing copy. This is an overclaim. WAV and FLAC are not reliably processable by the server. This should be corrected.

---

## Plan and pricing (confirmed from server.js and app.tsx)

| Plan | Price | Monthly limit | Batch | Source |
|---|---|---|---|---|
| Free | $0 | 3 files/month | ❌ | server.js `FREE_MONTHLY_LIMIT = 3` |
| Creator | $9.99/mo | Unlimited | ✅ | app.tsx line 228, server.js |
| Studio | $29.99/mo | Unlimited | ✅ | app.tsx line 256, server.js |
| Enterprise | (not in Stripe) | — | — | Type only in app.tsx line 32 |

---

## Risk model

**Critical risks** (failure causes data loss or trust violation):
1. SQLite on ephemeral Render disk → all user data lost on redeploy
2. ExifTool not removing provenance markers → core product guarantee violated
3. JWT_SECRET rotation without notice → all users logged out simultaneously
4. Stripe webhook `express.raw()` ordering changed → webhook signature verification broken → plan upgrades dropped

**High risks** (failure causes revenue loss or major UX degradation):
5. `VITE_API_URL` missing from build environment → frontend cannot reach backend
6. `FRONTEND_URL`/`ALLOWED_ORIGINS` misconfigured → CORS blocks all requests
7. Gemini API key invalid or quota exceeded → SEO generation unavailable
8. Stripe price ID mismatch → checkout session creation fails

**Medium risks** (failure causes user confusion or minor data issues):
9. WAV/FLAC accepted by Multer but rejected by processor → upload bandwidth wasted
10. JWT plan stale after Stripe webhook → user sees wrong plan until `/api/me` refresh
11. CI uses Node 18 but production uses Node 20.20.2 → potential native module incompatibility undetected

---

## Known discrepancies (as of May 2026)

| Location | Discrepancy |
|---|---|
| `.env.example` | Lists `VITE_API_URL`; `app.tsx` reads `VITE_API_URL` |
| `README.md` marketing copy | Claims WAV/FLAC support; processor rejects both |
| `.github/workflows/ci.yml` | Uses Node 18; production target is Node 20.20.2 |
| `README.md` | Lists `REDIS_URL` as a required production env var; Redis is not used in current codebase |

---

## Deployment platforms

Both Render and Spaceship Hyperlift are documented as deployment targets:
- `deploy.md`: Spaceship Hyperlift deployment guide (uses `hyperlift.toml`)
- `README.md`: Docker deployment with Render-style env var tables
- `.github/workflows/PIPELINE.md`: GitHub Actions to Docker Hub + Hyperlift rolling deploy

The plugin's deploy checklist covers both. When a specific platform matters, note which one.

---

## What does not exist (as of May 2026)

- No email verification
- No password reset
- No Google/OAuth login
- No automated unit or integration tests (only CI smoke test of `/api/health`)
- No job queue (batch processing is synchronous)
- No admin dashboard
- No Sentry or error monitoring
- No rate limiting (beyond per-user monthly limit)
- No Redis usage in current codebase
- No SpectraCleanse Admin MCP (planned — see docs/mcp-roadmap.md)
