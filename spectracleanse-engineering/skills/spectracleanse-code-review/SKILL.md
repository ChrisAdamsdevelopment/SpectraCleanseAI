# spectracleanse-code-review

**Use this skill when reviewing any code change in the SpectraCleanse repo** — especially changes to `server.js`, `app.tsx`, `server/cleansePolicy.js`, `server/processor.js`, `server/metadataRules.js`, or any file touching upload handling, auth, billing, or CORS.

---

## SpectraCleanse context

- `server.js` is a 637-line monolith. It owns auth, billing, upload, processing dispatch, SEO proxy, static serving, and CORS in one file. Changes here can regress multiple surfaces simultaneously.
- `app.tsx` is the entire React frontend in a single file. UI state for queue, processing, download, plan, upgrade modal, and auth all live here.
- `server/cleansePolicy.js` is the authoritative format support source of truth. Quick Cleanse: `.mp3` only. Full Server Cleanse: `.mp4`, `.m4a` only. Never assume other formats work without checking this file.
- `server/processor.js` wraps ExifTool. ExifTool operations are high-risk — incorrect flag construction, missing `await`, or unhandled rejection can corrupt output files silently.
- Gemini responses from `/api/generate-seo` use `gemini-2.5-flash` with structured JSON schema (`title`, `description`, `tags`). Parsing is done manually after `JSON.parse(rawText)` — any schema drift or upstream change can produce empty strings silently.
- JWT tokens carry `{ sub, email, plan }`. The `plan` field in the token is **not** re-read from the DB on every request — only `/api/me` re-fetches live plan. A plan desync between token and DB is a known risk after Stripe webhook delivery.
- Free tier: 3 files/month (checked in `/api/process` and `/api/process-batch`). Free users get `402` with `upgradeRequired: true`.
- Batch upload: `/api/process-batch`, paid plans only, up to 20 files, 2 GB total. Download uses one-time tokens from `server/downloadTokens.js`.
- CORS: strict in production. If `FRONTEND_URL` and `ALLOWED_ORIGINS` are both missing in prod, the server exits at startup. Changes to allowed origins or methods must be tested end-to-end.
- Frontend API base URL is `VITE_API_URL` (confirmed in `app.tsx` line 11). `.env.example` incorrectly lists `VITE_API_URL` — this discrepancy must not be introduced into new code.
- Response headers from `/api/process`: `X-Forensic-Removed`, `X-Forensic-Tags`, `X-Forensic-Status`, `X-Forensic-Report`, `X-Process-Run-Id`, `X-Output-SHA256`, `X-Download-Name`, `X-Usage-This-Month`, `X-Usage-Limit`. Frontend reads these — removing or renaming them is a breaking change.

---

## Checklist

**Upload and file handling**
- [ ] Does the change touch Multer config (`dest`, `limits`, `fileFilter`)? Verify MIME allow-list is unchanged or intentionally expanded.
- [ ] Does the change touch `normalizeExt` or `isServerSupportedFormat` in `cleansePolicy.js`? Verify format matrix is accurate.
- [ ] Are uploaded files cleaned up on all error paths (422, 402, 500, copy failure)?
- [ ] Is `req.file` null-checked before accessing `.path`, `.mimetype`, `.originalname`?
- [ ] Max file size is 500 MB (`MAX_FILE_SIZE`). Is this still enforced after the change?

**ExifTool / processor**
- [ ] Are all `exiftool` calls properly awaited?
- [ ] Is the output path distinct from the input path? (Copy-then-modify pattern must be preserved.)
- [ ] Are ExifTool errors caught and surfaced with appropriate HTTP status codes (`err.statusCode`, `err.publicDetail`)?
- [ ] Does `verifyFinalState` still run after processing and does its result appear in the report?
- [ ] Are metadata fields written via `buildMetaToWrite` — not raw user input — to ExifTool?

**Gemini SEO proxy**
- [ ] Does `/api/generate-seo` still validate `GEMINI_API_KEY` presence before calling the API?
- [ ] Is the Gemini response still parsed with a try/catch around `JSON.parse(rawText)`?
- [ ] Does the route handle non-200 Gemini responses (currently `throw new Error(\`Gemini error \${response.status}\`)`)? 
- [ ] Are output fields (`title`, `description`, `tags`) still type-checked as strings before being returned?
- [ ] Is `buildSeoPrompt` still sanitizing inputs with `asCleanText`?

**Auth / JWT**
- [ ] Does any new protected route use `requireAuth` middleware?
- [ ] Does `requireAuth` still check for `Bearer ` prefix and use `jwt.verify` with `JWT_SECRET`?
- [ ] If a new endpoint uses `req.user.sub`, is it verified that `sub` is the user's database `id`?
- [ ] Is there any path where `JWT_SECRET` could be empty in production (currently fails fast at startup)?

**Stripe billing**
- [ ] Does the Stripe webhook handler still use `express.raw({ type: 'application/json' })` — placed BEFORE `express.json()`? This ordering is critical.
- [ ] Does `checkout.session.completed` still write `plan`, `stripe_customer_id`, and `stripe_subscription_id` to the DB?
- [ ] Does `customer.subscription.deleted` still downgrade the user to `free`?
- [ ] Does `/api/create-checkout-session` still pass `userId` and `priceId` in `session.metadata`?
- [ ] Is `ENABLE_MOCK_CHECKOUT` gated to non-production only?
- [ ] Does the frontend call `/api/me` after the Stripe success redirect to pick up the upgraded plan?

**CORS and environment**
- [ ] Does the change add or modify CORS methods or headers? `allowedHeaders` currently: `Content-Type`, `Authorization`. `exposedHeaders` includes all `X-Forensic-*` and `X-Usage-*` headers.
- [ ] Does the change affect how `FRONTEND_URL` or `ALLOWED_ORIGINS` are parsed?
- [ ] Is `IS_PROD` (`process.env.NODE_ENV === 'production'`) used correctly for any new environment branching?

**Frontend / UI state**
- [ ] Does the change affect the upload queue, processing state, or download flow? Verify queue state cannot get stuck (uploaded but never cleared).
- [ ] Does any new `fetch` call handle 401 (re-auth) and 402 (upgrade modal) responses?
- [ ] Is `VITE_API_URL` used as the API base URL — not `VITE_API_URL` or a hardcoded `localhost`?
- [ ] Do plan badge, usage meter, and upgrade modal still reflect live data from `/api/me`?

**Render / deployment compatibility**
- [ ] Does the change introduce any dependency requiring native compilation (beyond `better-sqlite3` and `exiftool-vendored`)? These must be compatible with Render's Node 20 build environment.
- [ ] Does the change modify `package.json` `scripts`? The `start` script must remain `node server.js`.
- [ ] Does the change affect `dist/` serving? The `express.static(distPath)` block must remain after all `/api/` routes.

---

## Do not assume
- Do not assume WAV or FLAC are supported by Full Server Cleanse — verify `cleansePolicy.js`.
- Do not assume Quick Cleanse runs server-side — it uses `browser-id3-writer` in the browser.
- Do not assume the JWT `plan` field is live — it reflects plan at login time. Use `/api/me` for current plan.
- Do not assume Stripe mock checkout works in production — `ENABLE_MOCK_CHECKOUT` is false-by-default in prod.
- Do not assume the frontend env var is `VITE_API_URL` — the frontend reads `VITE_API_URL`.

---

## Output format

```
## Summary
[What changed and why]

## Blocking issues
[Anything that must be fixed before merge — data loss, auth bypass, silent failure, broken deploy]

## High-risk regressions
[Changes that could break existing functionality: format gating, plan enforcement, CORS, Stripe webhook order]

## Security / trust-boundary concerns
[JWT handling, raw user input to ExifTool, CORS origin widening, webhook signature bypass]

## Product behavior concerns
[UI state desync, wrong error messages, format claims that don't match cleansePolicy.js]

## Tests / smoke checks needed
[Specific curl commands or manual QA steps to verify this change is safe]

## Suggested patch plan
[Ordered list of fixes if blocking issues were found]
```

---

## Escalate if
- The Stripe webhook `express.raw()` middleware ordering has changed relative to `express.json()`.
- Any ExifTool call passes user-supplied filenames directly without sanitization.
- `JWT_SECRET` could be undefined in a production code path.
- CORS `origin` callback has been changed to return `true` unconditionally.
- `cleansePolicy.js` format lists have been expanded without a corresponding processor.js update.
