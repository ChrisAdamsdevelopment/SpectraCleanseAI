# spectracleanse-architecture

**Use this skill when making or evaluating architectural decisions for SpectraCleanse** — adding new features, refactoring the monolith, changing how files are processed, upgrading auth, or expanding to new deployment targets.

---

## SpectraCleanse context

Current architecture is a **single-process Node.js monolith** on Render/Hyperlift:
- `server.js` handles HTTP, auth, billing, file uploads, processing dispatch, SEO proxy, and static SPA serving in one process.
- SQLite (`better-sqlite3`) provides persistence. WAL mode enabled. Tables: `users` (id, email, password, plan, stripe_customer_id, stripe_subscription_id, created_at), `jobs` (id, user_id, filename, platform, created_at).
- File uploads land in `uploads/` on the local filesystem. `server/cleanup.js` handles deletion. Files are ephemeral — Render's filesystem is not persistent across deploys.
- ExifTool (`exiftool-vendored`) runs in the same Node process. It forks a Perl subprocess; the `exiftool` singleton is shared across requests.
- Gemini calls are synchronous HTTP from within the request handler — no queue, no retry, no fallback model.
- Stripe checkout is server-side session creation. Webhooks are received at `/api/stripe-webhook`.
- The frontend is a single `app.tsx` served as a Vite-built SPA from `dist/`.

**Known architectural constraints**:
- Render's free/hobby tiers have ephemeral disks. SQLite DB must be on a persistent volume (set `DB_PATH=/data/spectra.db` with a mounted volume) or data is lost on redeploy.
- `better-sqlite3` requires native compilation — incompatible with Node 24 (verified). Node 20.20.2 is the pinned target.
- Concurrent ExifTool operations share one subprocess pool. Heavy batch traffic could saturate it.
- No job queue currently exists. `/api/process-batch` is synchronous: all files processed sequentially before response.
- No email verification, password reset, or OAuth in the current auth system.

---

## Decision framework

For each architectural decision, produce this structure:

```
## Decision needed
[What specifically needs to be decided]

## Current facts (from repo)
[What the code actually does today — cite files]

## Constraints
[Render limitations, SQLite behavior, Node version, budget, solo-founder bandwidth]

## Options
[2–4 concrete options with brief description]

## Recommendation
[The option this analysis recommends and why]

## Tradeoffs
[What the recommendation gives up or risks]

## Migration path
[How to move from current state to recommended state without breaking production]

## Risks
[What could go wrong during or after the change]

## Open questions
[What must be answered before committing to this decision]
```

---

## Common SpectraCleanse architectural questions

### Monolith vs. split API/worker
Current: one process handles HTTP and ExifTool processing.
Risk: long ExifTool jobs block the event loop for other requests.
Consideration: Render worker services are available. A job queue (BullMQ + Redis, or a simple SQLite-backed queue) would allow the HTTP server to return a job ID immediately while a worker processes the file. This is a medium-complexity change with significant UX improvement for batch uploads.
Do not recommend splitting without accounting for: shared `uploads/` filesystem between API and worker processes, SQLite concurrency (WAL handles reads, but writes from two processes need careful design), and Render persistent disk cost.

### SQLite now vs. Postgres later
Current: SQLite with WAL. Works well for a single-process, low-concurrency app.
Migration trigger: if a second process (worker) needs to write concurrently, or if Render disk cost becomes a bottleneck, or if user base grows to thousands of concurrent sessions.
Migration path: schema is simple (`users`, `jobs`). Drizzle ORM or Knex would make a Postgres swap low-risk. The main change is connection pooling (`pg` pool vs. single SQLite connection).
Do not recommend migrating until the SQLite bottleneck is actually observed.

### File storage / retention model
Current: uploaded files land in `uploads/` and are deleted by `cleanup.js` after download or on a timer. Output files are also deleted after `res.download()`.
Risk: if the server restarts before a file is downloaded, it's lost. One-time download tokens (`server/downloadTokens.js`) expire, so users may lose output files.
Consideration: S3/R2 object storage would give durable file URLs with TTLs. This is the right next step if batch download failure reports increase.

### Auth upgrades (email verification, password reset, Google OAuth)
Current: register/login with email + bcrypt, JWT, no verification or reset flow.
Email verification: requires an email provider (Resend, Postmark, or SendGrid) and a new `email_verified` column in `users`. Add before user base grows significantly.
Password reset: token-based; requires `password_reset_tokens` table and email provider.
Google OAuth: requires `google-auth-library`, a new `oauth_provider` column, and handling the case where a Google email matches an existing password account.
Priority order: email verification → password reset → OAuth.

### Processing job queue design
Options: (1) in-process async queue (simple but still blocks one Node thread), (2) SQLite-backed queue (add `status`, `result` columns to `jobs` table — no new infra), (3) BullMQ + Redis (robust, requires Redis on Render), (4) Render background worker service.
Recommendation for current scale: SQLite-backed queue with a polling worker. Adds async processing without new infra cost.

### Admin dashboard / MCP integration
Current: no admin interface exists.
Recommendation: build a minimal admin MCP server first (see `docs/mcp-roadmap.md`). This gives Claude-accessible deploy health and usage stats before building a full web admin UI.

### Supported file format expansion
Before adding any new format to `cleansePolicy.js`:
1. Verify ExifTool can reliably read AND write the format without data loss.
2. Add a test fixture (a real file of that format with known metadata).
3. Update `ALLOWED_MIME` in `server.js` to accept the new MIME type.
4. Update `isServerSupportedFormat` in `cleansePolicy.js`.
5. Update user-facing docs and error messages.
Do not add format support based on MIME accept-list alone — Multer allows it but the processor may silently corrupt or fail.

---

## Do not assume
- Do not assume Render has a persistent disk by default — it must be explicitly configured and mounted.
- Do not assume SQLite handles concurrent writes from multiple processes safely without WAL + careful transaction design.
- Do not assume ExifTool can process any format in `ALLOWED_MIME` — Multer and ExifTool have independent format support.
- Do not assume a job queue exists — batch processing is currently synchronous.
- Do not assume email sending is available — no email provider is currently configured.

---

## Escalate if
- A decision would require data migration on the live `spectra.db` without a tested migration script and rollback plan.
- A decision would make the Stripe webhook unreachable (changing the `/api/stripe-webhook` path or removing `express.raw()` ordering).
- A decision involves storing files outside the current `uploads/` pattern without a verified cleanup strategy.
