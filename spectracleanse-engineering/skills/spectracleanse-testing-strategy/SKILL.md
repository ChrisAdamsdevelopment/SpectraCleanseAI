# spectracleanse-testing-strategy

**Use this skill when designing, auditing, or improving SpectraCleanse's test coverage.** Start by checking what tests actually exist — do not assume a test suite is in place. The goal is a pragmatic test plan calibrated to a solo-founder shipping cadence.

---

## SpectraCleanse context

### Current test surface (confirmed from repo)

**CI smoke test** (`.github/workflows/ci.yml`): starts the server with CI-safe env vars and checks that `/api/health` returns HTTP 200. This is the only automated test currently in the pipeline. It uses Node 18 in CI (diverges from production Node 20.20.2).

**Manual QA checklist** (`docs/manual-qa-checklist.md`): comprehensive manual testing guide covering local setup, API smoke tests, auth, billing/mock checkout, file upload, metadata analysis, SEO generation, ExifTool verification, download flow, Docker, and production readiness.

**No unit tests, no integration tests, no frontend tests** were found in `package.json` (no test runner configured: no Jest, Vitest, Mocha, or Playwright dependency).

**`package.json` scripts**: `start`, `dev:backend`, `dev:frontend`, `build`, `preview` — no `test` script.

---

## Highest-risk flows (ranked by severity of undetected failure)

1. **Stripe webhook processing** — `customer.subscription.deleted` silently failing means paid users are not downgraded. `checkout.session.completed` failing means upgrades are silently dropped. Neither is currently tested.

2. **Plan enforcement at `/api/process`** — a regression here could let free users exceed their limit or block paid users. Currently tested only manually.

3. **ExifTool output correctness** — a processor regression could silently fail to remove provenance markers (the core product guarantee). No automated verification of output file metadata.

4. **JWT expiry and `requireAuth` middleware** — a middleware change could allow unauthenticated access. Currently caught only by CI server startup test.

5. **CORS in production** — wrong origin config exits the server at startup but a partial misconfiguration (wrong URL) would allow incorrect origins or block the real frontend silently.

6. **Gemini JSON parsing** — schema drift from Gemini could produce empty strings silently. The try/catch returns 502 but the empty-string case (field present, wrong type) would return 200 with empty strings.

7. **Format gating** — a change to `cleansePolicy.js` or `ALLOWED_MIME` that opens or closes format support unexpectedly. Not currently tested automatically.

8. **Free-tier limit counting** — `getMonthlyJobCount` uses `strftime('%Y-%m', created_at)`. A timezone or formatting bug could cause incorrect limit enforcement.

---

## Recommended test suite (phased)

### Phase 1: Minimal automated safety net (highest ROI, no new dev dependencies)

Add these as shell-script smoke tests in CI, extending the existing `.github/workflows/ci.yml`:

**Test 1: `/api/health` returns OK** *(already exists — keep it)*

**Test 2: Unauthenticated request → 401**
```bash
curl -sf -o /dev/null -w "%{http_code}" http://localhost:3001/api/me | grep -q "401"
```

**Test 3: Unknown API route → 404 JSON (not HTML)**
```bash
curl -sf http://localhost:3001/api/nonexistent | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'error' in d"
```

**Test 4: Registration → Login → /api/me round-trip**
```bash
# Register
TOKEN=$(curl -sf -X POST http://localhost:3001/api/register \
  -H "Content-Type: application/json" \
  -d '{"email":"ci-test@example.com","password":"ci-password-1234"}' | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
# /api/me with token
curl -sf http://localhost:3001/api/me -H "Authorization: Bearer $TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); assert d['user']['plan'] == 'free'"
```

**Test 5: Unsupported file type → 422**
```bash
# POST a text file to /api/process (MIME will be rejected by Multer as 415)
curl -sf -X POST http://localhost:3001/api/process \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test.txt;type=text/plain" \
  -o /dev/null -w "%{http_code}" | grep -qE "415|422"
```

**Test 6: Mock checkout returns a URL**
```bash
# Requires ENABLE_MOCK_CHECKOUT=true in CI env
curl -sf -X POST http://localhost:3001/api/create-checkout-session \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"plan":"creator"}' | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'url' in d"
```

### Phase 2: Unit tests for critical server logic (Jest or Vitest — add as devDependency)

Priority targets:
- `planFromPriceId()` — maps price IDs to plan names; edge case: unknown price ID → `'creator'`
- `getMonthlyJobCount()` — boundary: exactly 3 jobs in current month, 0 in previous month
- `buildSeoPrompt()` — empty payload → returns `''`; non-empty payload → returns non-empty string
- `asCleanText()` — max-length truncation; null/undefined input; string with null bytes
- `normalizeExt()` — `.mp4`, `.MP4`, no extension, multiple dots
- `isServerSupportedFormat()` — MP4 by extension, M4A by MIME alias, WAV (should return false)
- `detectMarkers()` — rule matching against mock tag sets
- `verifyFinalState()` — passes with only benign/allowed-injected tags; fails with unexpected tags

### Phase 3: Integration tests with real ExifTool (requires test fixtures)

Test fixtures needed (small real files, no content — metadata only):
- `fixtures/test.mp4` — MP4 with known provenance-marker tags pre-embedded
- `fixtures/test.m4a` — M4A with QuickTime timestamps and custom fields
- `fixtures/test.mp3` — MP3 for Quick Cleanse browser-side (not server-side)
- `fixtures/test.wav` — WAV for rejection testing

For each fixture:
1. Pre-processing: capture ExifTool tag output
2. Run through `processMediaFile()`
3. Post-processing: verify specified tags are removed, `verifyFinalState().passed === true`, injected tags are present with correct values

### Phase 4: End-to-end browser tests (Playwright — planned)

Flows to automate:
- Register → login → upload MP4 → download → verify response headers
- Free-tier limit: upload 4 files → 4th triggers upgrade modal
- Upgrade flow (mock checkout) → success → plan badge updates
- Quick Cleanse: drop MP3 → browser-side processing → download
- Unsupported format: drop WAV to server process → error message shown

---

## CI plan

```yaml
# Extend .github/workflows/ci.yml
- name: Run API smoke tests
  run: |
    export JWT_SECRET=ci-test-secret
    export STRIPE_SECRET_KEY=sk_test_ci_placeholder
    export STRIPE_WEBHOOK_SECRET=whsec_ci_placeholder
    export STRIPE_CREATOR_PRICE_ID=price_ci_creator
    export STRIPE_STUDIO_PRICE_ID=price_ci_studio
    export FRONTEND_URL=http://localhost:5173
    export DB_PATH=/tmp/spectra-ci.db
    export PORT=3001
    export ENABLE_MOCK_CHECKOUT=true
    node server.js &
    # wait for ready
    sleep 5
    bash ./scripts/smoke-tests.sh  # create this file with the Phase 1 tests above
```

Note: Node version in CI is currently 18, but production uses 20.20.2. Recommend updating CI to `node-version: "20.20.2"` to match production.

---

## Output format

```
## Current test surface
[What tests actually exist — confirmed from package.json and workflow files]

## Missing coverage
[Ranked list of untested flows by risk]

## Highest-risk flows
[Top 3–5 flows where an undetected regression would most hurt users]

## Recommended tests
[Specific test cases with input/expected output]

## Minimal first test suite
[The smallest set of tests that meaningfully improves safety — runnable this week]

## Longer-term CI plan
[Phase plan for getting to full integration test coverage]
```

---

## Do not assume
- Do not assume a test runner (Jest, Vitest, etc.) is installed — check `package.json` devDependencies first.
- Do not assume a `test` script exists in `package.json` — it does not currently.
- Do not assume ExifTool test fixtures exist — they must be created.
- Do not assume CI/runtime alignment from memory — verify `.nvmrc` and workflow files directly before reporting.
- Do not recommend tests that require live Stripe or Gemini API keys in CI — use mocks or env-gated skips.
