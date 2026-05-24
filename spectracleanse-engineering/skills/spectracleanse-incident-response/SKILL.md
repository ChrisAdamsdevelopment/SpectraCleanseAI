# spectracleanse-incident-response

**Use this skill when SpectraCleanse has a production issue** — broken deploy, auth outage, Stripe failure, Gemini failure, processing failures, CORS breakage, or database issues. This skill is about triage speed and user-impact containment. It separates known facts from guesses.

---

## Incident classes and SpectraCleanse-specific causes

| Class | Likely first signal | Immediate check |
|---|---|---|
| Broken Render/Hyperlift deploy | `/api/health` → 502/504 or timeout | Render/Hyperlift build logs; startup crash |
| Build/runtime mismatch | Server exits immediately after deploy | Check Node version; better-sqlite3 compile error |
| CORS failure | Browser console: "CORS blocked" | `FRONTEND_URL`/`ALLOWED_ORIGINS` env vars; CORS header in response |
| Auth outage | All requests → 401 | `JWT_SECRET` rotation; middleware regression |
| Checkout outage | Upgrade flow returns error | Stripe env vars; `STRIPE_CONFIGURED` check; Stripe Dashboard status |
| Gemini outage/schema failure | SEO generation fails or returns empty strings | Gemini API status; `GEMINI_API_KEY` validity; response JSON shape |
| Processing failures | `/api/process` → 500 | ExifTool logs; `exiftoolFailureError` reason; file copy path |
| Unsupported-format spike | 422 errors on user uploads | Format in request; `cleansePolicy.js` changes |
| Database/persistence issue | 500 on auth or job recording | `DB_PATH` env var; disk mount; WAL corruption |
| Frontend/backend URL mismatch | Frontend can't reach API | `VITE_API_URL` build env var; network tab in browser |

---

## Triage protocol

**Always do these first:**

1. **Check `/api/health`**: `curl https://api.spectracleanse.com/api/health`
   - Returns `{"status":"ok"}` → backend is up; the issue is likely specific to a route or env.
   - Hangs or returns 502/504 → backend is not running; check Render deploy logs.
   - Returns HTML → reverse proxy issue or SPA fallback catching `/api/` routes (check the `app.use('/api', ...)` 404 handler).

2. **Check Render/Hyperlift logs**: Look for:
   - `FATAL:` lines at startup (missing `JWT_SECRET`, Stripe not configured, CORS origin missing)
   - ExifTool errors (Perl subprocess failure)
   - SQLite errors (cannot open database, disk I/O error)
   - `SIGTERM` followed by `exiftool.end()` (graceful shutdown — expected during redeploy)

3. **Establish user impact**: Are all users affected or only specific plans/actions?

4. **Separate facts from guesses**: Document what you have confirmed vs. what you suspect.

---

## Incident response for each class

### Broken Render/Hyperlift deploy
**Immediate check**: Render deploy log. Common causes:
- `npm ci` fails → dependency issue or package-lock mismatch
- `tsc` fails → TypeScript errors introduced in the PR
- `vite build` fails → import error or Vite config issue
- Server starts but `/api/health` fails → startup `process.exit(1)` from missing env var
- `better-sqlite3` native compilation fails → Node version incompatibility (check for Node 24 being used instead of 20.20.2)

**Containment**: Rollback to the previous deploy SHA in Render/Hyperlift dashboard.

### CORS failure
**Symptoms**: Browser console shows `CORS blocked for origin: https://spectracleanse.com`.
**Causes**:
1. `FRONTEND_URL` env var is missing or has a typo (trailing slash, `http://` instead of `https://`)
2. `ALLOWED_ORIGINS` env var was cleared or misconfigured
3. A deploy changed how `allowedOrigins` is constructed in `server.js`
4. The Stripe webhook URL was changed to a path the CORS config doesn't cover (not applicable — Stripe is server-to-server)

**Fix**: Correct `FRONTEND_URL` in Render env → redeploy or restart service.

**Note**: CORS errors appear in browser console, not in server logs. Always check browser network tab for the actual `Origin` header being sent and the `Access-Control-Allow-Origin` header (or lack thereof) in the response.

### Auth outage (all users → 401)
**Causes**:
1. `JWT_SECRET` was rotated in the deploy — all existing tokens are invalid
2. `requireAuth` middleware was changed (header parsing regression)
3. Server restarted with a different `JWT_SECRET` value

**Containment**: If `JWT_SECRET` was rotated, all users must re-login. This cannot be undone without reverting the secret — which would invalidate the new tokens.

**Fix**: Ensure `JWT_SECRET` is stable across deploys. Use a persistent env var, not a generated-at-startup value.

### Checkout outage
**Symptoms**: `POST /api/create-checkout-session` returns error or mock redirect in production.
**Causes**:
1. `STRIPE_CONFIGURED` is false → one or more of the four Stripe env vars is missing
2. `FRONTEND_URL` is missing → `success_url`/`cancel_url` are broken → Stripe rejects session creation
3. Stripe API is down → check https://status.stripe.com
4. Price ID mismatch → `priceId` is undefined → `/api/create-checkout-session` falls through to mock or 503

**Containment**: If Stripe is down, show a maintenance message. Do not attempt to process payments offline.

### Gemini outage / schema failure
**Symptoms**: `/api/generate-seo` returns 500, 502, or empty `{ title: '', description: '', tags: '' }`.
**Causes**:
1. `GEMINI_API_KEY` invalid or quota exceeded → 400/403 from Gemini → 500 to client
2. Gemini returns non-JSON response → `JSON.parse` fails → 502
3. Gemini returns JSON but with different schema keys → fields are empty strings (type-checked but wrong key)
4. Gemini API is degraded → check https://status.cloud.google.com

**Containment**: The SEO generation endpoint is separate from processing. Processing still works without Gemini. Communicate that AI metadata generation is temporarily unavailable if Gemini is down.

### Processing failures (`/api/process` → 500)
**Causes**:
1. ExifTool subprocess failure (`exiftoolFailureError`) — check for ExifTool version issues or malformed file
2. File copy failure (`fs.copy` error) — check disk space in `uploads/`
3. Missing output file path — verify `uploads/` directory exists (`fs.ensureDirSync` runs at startup)
4. Unhandled exception in `processor.js` — check for new error paths not covered by `try/catch`

**Containment**: Processing failures are per-file and do not affect other users. The upload file is cleaned up on error paths. No action needed unless failure rate is elevated.

### Database / persistence issue
**Symptoms**: 500 on login, register, or job recording. SQLite errors in logs.
**Causes**:
1. `DB_PATH` points to ephemeral disk that was wiped on redeploy → all users lost → critical
2. SQLite WAL file corruption → use `PRAGMA integrity_check;` to diagnose
3. Disk full → SQLite write fails

**Containment**: If DB is on ephemeral disk and was wiped, user data is lost. Verify persistent disk mount immediately. Restore from most recent backup if one exists.

### Frontend/backend URL mismatch
**Symptoms**: Browser network tab shows requests going to `undefined` or `localhost:3001` in production.
**Cause**: `VITE_API_URL` was not set in the **build environment** before `vite build` ran. The frontend built with an empty API URL.
**Fix**: Set `VITE_API_URL` in Render's build environment (not runtime env) and trigger a rebuild.

---

## Output format

```
## Incident title
[Short description: "SpectraCleanse: [class] – [date/time]"]

## Severity
[P0: all users blocked | P1: major feature down | P2: degraded | P3: minor]

## User impact
[Who is affected and what they cannot do]

## Timeline
[Time detected, time of last known-good deploy, events since]

## Known facts (confirmed)
[What has been directly observed: logs, HTTP responses, env var values]

## Hypotheses (not confirmed)
[Ranked list of likely causes — mark clearly as unconfirmed]

## Immediate containment
[What to do right now to stop user impact spreading: rollback, disable feature, show maintenance]

## Investigation steps
[Ordered diagnostic commands and log checks]

## Fix
[The specific code or config change that resolves the issue]

## Verification
[How to confirm the fix worked: smoke tests, curl commands]

## Prevention items
[What to add to the deploy checklist or monitoring to catch this earlier next time]
```

---

## Do not assume
- Do not say "the server is up" without checking `/api/health` first.
- Do not say "Stripe is configured" without verifying all four env vars.
- Do not say "the DB is intact" without querying it directly.
- Do not assume a CORS error means the backend is down — the backend may be running fine with misconfigured origins.
- Do not say "the Gemini API key is valid" without observing the actual HTTP response from the Gemini API.

---

## Escalate if
- SQLite DB was on an ephemeral disk and has been wiped — user data loss situation.
- `JWT_SECRET` was rotated with no warning — all sessions invalidated simultaneously.
- A processing bug silently corrupted output files (metadata was not removed, or wrong metadata was injected) — trust and legal implications.
- Stripe charges succeeded but plan upgrades were not applied to the DB — revenue collected without service delivered.
