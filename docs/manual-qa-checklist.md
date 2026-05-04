# SpectraCleanseAI Manual QA Checklist

Use this checklist before and after deployment to validate critical functionality consistently.

## 1) Local setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Build the app:
   ```bash
   npm run build
   ```
3. Start the server with safe local environment variables:
   ```bash
   NODE_ENV=development JWT_SECRET=dev_jwt_secret_change_me ENABLE_MOCK_CHECKOUT=true DB_PATH=./spectra.db FRONTEND_URL=http://localhost:5173 PORT=3001 npm start
   ```
4. Open the app in a browser:
   - `http://localhost:3001`
5. Verify health endpoint:
   - `GET http://localhost:3001/api/health`
   - Expected: JSON response with HTTP `200`.

## 2) API smoke tests

Run these checks against your local server:

1. `GET /api/health`
   - Expected: JSON body, HTTP `200`.
2. `GET /api/me` without token
   - Expected: JSON error, HTTP `401`.
3. `GET /api/nonexistent`
   - Expected: JSON error, HTTP `404`.
4. Unknown frontend route (example: `/some/random/page`)
   - Expected: app shell/index HTML loads (SPA fallback).
5. Confirm routing boundary
   - Expected: `/api/*` routes are **not** swallowed by SPA fallback.

## 3) Auth flow QA

1. Register a new user.
2. Log in with valid credentials.
3. Refresh browser and confirm session restore works.
4. Log out and confirm protected actions require login again.
5. Attempt invalid login and verify user-facing error handling.

## 4) Billing / Stripe / mock checkout QA

1. With `ENABLE_MOCK_CHECKOUT=true`, trigger upgrade/checkout locally.
   - Expected: mock checkout behavior (no real Stripe charge).
2. Hit free-tier limit or simulate `402` response.
   - Expected: upgrade modal opens.
3. Complete local mock checkout path.
   - Expected: checkout success banner appears.
4. Trigger checkout cancel flow (if available in current UI).
   - Expected: checkout cancel banner/message appears.
5. Production readiness note:
   - Real Stripe secret key, webhook secret, and price IDs must be configured.

## 5) File upload QA

1. Upload a supported MP3 file.
2. Upload another supported format (for example WAV or MP4, if available).
3. Try an unsupported file type.
   - Expected: validation/rejection message.
4. Test file size limits if documented.
   - Expected: behavior matches documented constraints.
5. Confirm uploaded item appears in the processing queue/list.

## 6) Metadata analysis QA

1. After upload, confirm metadata analysis runs automatically.
2. Verify displayed metadata includes title, artist, genre, and format (when present).
3. Verify provenance risk display is visible.
4. If file metadata includes known markers, verify detected markers list is shown.
5. Use malformed/minimal metadata sample if available.
   - Expected: parse failure is handled gracefully and app does not crash.

## 7) Generate AI SEO Payload QA

1. Ensure file/context is present, then run SEO generation.
2. Verify generated title, description, and tags populate UI fields.
3. Test failure mode (missing `GEMINI_API_KEY` or simulated API failure).
   - Expected: clear error handling/message.
4. Confirm existing SEO fields are not destructively cleared on generation failure.

## 8) Quick Cleanse Browser QA

1. On MP3 input, verify MP3-only quick cleanse action/button is enabled.
2. On non-MP3 input, verify quick cleanse is disabled or unavailable.
3. Run quick cleanse for supported MP3.
4. Verify a manual download link appears.
5. Confirm no auto-download is triggered.
6. Download processed MP3.
7. Re-upload or inspect resulting MP3 and confirm metadata fields changed as expected.
8. Confirm system logs show cleanse success/failure path.

## 9) Full Server Cleanse QA

1. Run server cleanse on a supported file.
2. Verify `/api/process` returns downloadable file response.
3. Verify usage meter/counter updates.
4. Verify forensic/report information appears when present.
5. Force or simulate `401` from protected endpoint.
   - Expected: user is logged out/reauth requested.
6. Force or simulate `402`.
   - Expected: upgrade modal opens.

## 10) Object URL / download safety QA

1. Process a file and copy/download the generated link.
2. Replace with a newly processed file.
   - Expected: old object URL/link is no longer used by current UI state.
3. Remove queue item.
4. Refresh page.
5. Confirm no obvious stale/broken download UI remains.

## 11) Docker deployment QA

> Note: Docker was unavailable in Codex audits; run these steps manually in a Docker-capable environment.

1. Build image:
   ```bash
   docker build -t spectracleanseai:test .
   ```
2. Run container (example):
   ```bash
   docker run --rm -p 3001:3001 \
     -e NODE_ENV=production \
     -e JWT_SECRET=replace_with_strong_secret \
     -e STRIPE_SECRET_KEY=sk_live_or_test_xxx \
     -e STRIPE_WEBHOOK_SECRET=whsec_xxx \
     -e STRIPE_CREATOR_PRICE_ID=price_xxx \
     -e STRIPE_STUDIO_PRICE_ID=price_xxx \
     -e GEMINI_API_KEY=your_gemini_api_key \
     -e FRONTEND_URL=https://your-frontend-domain.example \
     -e DB_PATH=/data/spectra.db \
     -v spectracleanse_data:/data \
     spectracleanseai:test
   ```
3. Verify app loads from container at `http://localhost:3001`.
4. Verify `GET /api/health` returns JSON `200`.
5. Verify unknown frontend route returns SPA fallback.
6. Verify `GET /api/nonexistent` returns JSON `404`.

## 12) Production readiness checklist

- [ ] `JWT_SECRET` is strong and unique.
- [ ] Stripe secret, webhook secret, and price IDs are configured.
- [ ] `GEMINI_API_KEY` is configured.
- [ ] `DB_PATH` points to persistent storage.
- [ ] `FRONTEND_URL` is correct for deployed frontend.
- [ ] `NODE_ENV=production`.
- [ ] No real secrets are committed to source control.
- [ ] `.env` is gitignored.
- [ ] Backup/persistence plan exists for database.
- [ ] Upload/data volume mount is configured for expected data volume.

## 13) Known warnings

- `npm audit` currently reports vulnerabilities and should be triaged.
- `music-metadata-browser` is deprecated and currently used only for browser-side metadata analysis; plan a replacement/redesign in a future PR.
- Treat suspicious or corrupt media samples as high-risk during manual QA and verify metadata analysis paths carefully.
- Docker build/runtime validation still requires a real Docker-capable environment.
