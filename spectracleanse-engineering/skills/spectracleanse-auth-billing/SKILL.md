# spectracleanse-auth-billing

**Use this skill when debugging or reviewing auth flows, JWT state, plan enforcement, Stripe checkout, or upgrade/downgrade behavior in SpectraCleanse.**

---

## SpectraCleanse context (confirmed from repo)

### Auth system
- **Registration**: `POST /api/register` — email + password (min 8 chars). Emails normalized to lowercase. Passwords hashed with `bcrypt` (cost 12). Returns JWT + user object on success. 409 if email already exists.
- **Login**: `POST /api/login` — returns JWT + user object. Constant-time comparison (bcrypt.compare even for unknown emails via dummy hash).
- **JWT**: signed with `JWT_SECRET`, 7-day expiry, payload: `{ sub: userId, email, plan }`. Stored client-side (localStorage or memory — verify from `app.tsx`).
- **Auth middleware** (`requireAuth`): checks `Authorization: Bearer <token>` header, verifies with `jwt.verify(token, JWT_SECRET)`. Returns 401 on missing header or invalid/expired token.
- **No email verification, no password reset, no OAuth** currently exists.
- **`/api/me`** (GET, authenticated): queries DB for current user, returns `{ user: { id, email, plan, created_at }, usage: { thisMonth, limit } }`. This is the only endpoint that returns the **live plan from DB** — the JWT plan field is stale if a Stripe webhook has fired since login.

### Plan system
- Plans: `free`, `creator`, `studio` (and `enterprise` in frontend types — not a current Stripe product).
- Free: 3 files/month (`FREE_MONTHLY_LIMIT = 3`). Enforced in `/api/process` and implicitly in `/api/process-batch` (403).
- Creator: `$9.99/mo`, `STRIPE_CREATOR_PRICE_ID`.
- Studio: `$29.99/mo`, `STRIPE_STUDIO_PRICE_ID`.
- Downgrade: `customer.subscription.deleted` Stripe event → `plan = 'free'`, `stripe_subscription_id = NULL` in DB.
- Plan from DB, not from JWT: after a Stripe webhook, the DB is updated but the user's JWT still carries the old plan. The frontend must call `/api/me` to pick up the upgrade. This is done after the Stripe success redirect (see `app.tsx` line 627).

### Stripe checkout
- `POST /api/create-checkout-session` (authenticated): creates a Stripe Checkout session in `subscription` mode.
- Re-uses existing `stripe_customer_id` if available; creates a new Stripe Customer otherwise.
- `success_url`: `${FRONTEND_URL}?checkout=success&session_id={CHECKOUT_SESSION_ID}`
- `cancel_url`: `${FRONTEND_URL}?checkout=cancelled`
- `metadata`: `{ userId, priceId }` — both required for webhook processing.
- Local dev mock: if `STRIPE_CONFIGURED` is false and `ENABLE_MOCK_CHECKOUT` is true, returns a mock success redirect without hitting Stripe.

### Stripe webhook
- `POST /api/stripe-webhook` — must be registered BEFORE `express.json()` (uses `express.raw()`). This ordering is critical; changing it breaks signature verification.
- Handles: `checkout.session.completed` (upgrades user plan), `customer.subscription.deleted` (downgrades to free).
- `checkout.session.completed`: reads `session.metadata.userId` and `session.metadata.priceId`. If `userId` is missing, logs an error and returns — the user's plan will not be upgraded.
- `planFromPriceId()`: maps `STRIPE_STUDIO_PRICE_ID` → `'studio'`, `STRIPE_CREATOR_PRICE_ID` → `'creator'`, anything else → `'creator'` (safe fallback).

### Usage tracking
- `jobs` table: one row per processed file, with `user_id`, `filename`, `platform`, `created_at`.
- `getMonthlyJobCount(userId)`: counts jobs for current calendar month.
- Counter incremented in `/api/process` after successful processing. Also incremented per-file in `/api/process-batch`.
- `/api/me` returns `usage.thisMonth` and `usage.limit` (`3` for free, `null` for paid).

---

## Debugging flow

### User can't log in
1. Check: is the email normalized to lowercase? (Registration normalizes; login normalizes too — should match.)
2. Check: was the account registered? Query: `SELECT id, email, plan FROM users WHERE email = LOWER('[email]');`
3. Check: is `JWT_SECRET` the same value as when the token was issued? A secret rotation invalidates all existing tokens.
4. Check: is the Authorization header formatted correctly (`Bearer [token]` — note the space)?
5. Check: is the token expired? JWT expiry is 7 days.

### User upgraded but app still shows free plan
1. Check: did the Stripe webhook fire? Look for a Stripe Dashboard → Developers → Webhooks → event log entry for `checkout.session.completed`.
2. Check: was `session.metadata.userId` populated? If not, the webhook handler skips the DB update.
3. Check: did `STRIPE_WEBHOOK_SECRET` match? A signature failure returns 400 to Stripe, which retries — but the plan won't update until signature verification passes.
4. Check: did the frontend call `/api/me` after the success redirect? The plan in the JWT is stale. The `?checkout=success` handler in `app.tsx` triggers a re-fetch.
5. Check: is the plan in the DB? Query: `SELECT id, email, plan, stripe_customer_id, stripe_subscription_id FROM users WHERE id = [userId];`
6. If DB shows upgraded plan but frontend still shows free: the JWT is stale. User needs to call `/api/me` or re-login to get a fresh token with the new plan baked in (though JWT plan is not re-read by `/api/process` — it re-queries the DB for `plan`).

### User hits 402 unexpectedly
1. Check: what is `getMonthlyJobCount(userId)` returning? 402 fires when count ≥ 3 for free users.
2. Check: is the user's plan `free` in the DB? If Stripe webhook failed, they may have paid but DB wasn't updated.
3. Check: is the month correct? The count query uses `strftime('%Y-%m', created_at)` vs `strftime('%Y-%m', 'now')`. If the server timezone differs from what the user expects, the monthly window may be off.

### Checkout session creation fails
1. Check: are all four Stripe env vars set (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CREATOR_PRICE_ID`, `STRIPE_STUDIO_PRICE_ID`)?
2. Check: is `stripe` null? It's set to null if `STRIPE_CONFIGURED` is false.
3. Check: is `priceId` non-null? If `plan` is not `'studio'`, it uses `STRIPE_CREATOR_PRICE_ID` — if that env var is empty, `priceId` is `undefined`.
4. Check: is `FRONTEND_URL` set? The `success_url` and `cancel_url` are built from `FRONTEND_URL`. If missing, Stripe will reject the session.

### 401 on a valid request
1. Check: is the `Authorization` header present and starts with `Bearer `? (Note the space — `requireAuth` uses `header.slice(7)`.)
2. Check: is the token expired? (7-day TTL)
3. Check: was `JWT_SECRET` rotated since the token was issued?
4. Check: is the request being made to the correct backend URL? A mismatch between `VITE_API_URL` and the actual backend domain would result in CORS errors, not 401s — but confirm the request is reaching the server.

---

## Checklist

**Auth flows**
- [ ] `/api/register` returns 201 + token on success
- [ ] `/api/register` returns 409 if email already exists
- [ ] `/api/login` returns 200 + token on valid credentials
- [ ] `/api/login` returns 401 on invalid credentials (constant-time path)
- [ ] `/api/me` returns 401 without token, 200 + live plan data with valid token
- [ ] Token expiry (7d) enforced by `jwt.verify`
- [ ] `JWT_SECRET` is set and non-empty in production (server exits at startup if missing)

**Plan and usage**
- [ ] Free users receive 402 after 3 files/month with `upgradeRequired: true`
- [ ] Paid users do not hit the monthly limit (limit is `null` from `/api/me`)
- [ ] Usage counter increments correctly after `/api/process` success
- [ ] `/api/me` returns accurate `usage.thisMonth` and `usage.limit`

**Stripe checkout**
- [ ] `/api/create-checkout-session` returns a Stripe Checkout URL (not mock URL) in production
- [ ] `success_url` and `cancel_url` point to the correct `FRONTEND_URL`
- [ ] `session.metadata` contains `userId` and `priceId`
- [ ] Existing Stripe customers are re-used (`stripe_customer_id` stored in DB)
- [ ] Frontend calls `/api/me` on `?checkout=success` to refresh plan

**Stripe webhook**
- [ ] `POST /api/stripe-webhook` is registered before `express.json()` in `server.js`
- [ ] Webhook signature verified with `stripe.webhooks.constructEvent()`
- [ ] `checkout.session.completed` updates `plan`, `stripe_customer_id`, `stripe_subscription_id` in DB
- [ ] `customer.subscription.deleted` resets `plan = 'free'` in DB
- [ ] Webhook endpoint is registered in Stripe Dashboard with correct signing secret

---

## Output format

```
## Symptom
[What the user or system is experiencing]

## Likely causes (ranked)
[1. Most likely cause — 2. Next most likely — etc.]

## Files / endpoints to inspect
[server.js lines, DB queries, Stripe Dashboard locations]

## Debug steps
[Ordered diagnostic commands and checks]

## Fix plan
[Specific code or config changes]

## Regression tests
[Curl commands or manual steps to verify the fix]

## User-facing impact
[What users experienced and whether data was lost or degraded]
```

---

## Do not assume
- Do not assume the JWT plan field is current — it may be stale after a Stripe webhook. Always use `/api/me` for live plan.
- Do not assume mock checkout works in production — `ENABLE_MOCK_CHECKOUT` must not be `true` in prod.
- Do not assume Stripe webhook delivery is instant — events can be delayed or retried.
- Do not assume email verification exists — there is currently no email verification in the auth system.
- Do not assume `VITE_BACKEND_URL` is the correct frontend env var — the frontend reads `VITE_API_URL`.

---

## Escalate if
- A user's plan is `studio` or `creator` in Stripe but `free` in the DB — webhook may have failed silently.
- `JWT_SECRET` has been rotated and all sessions are invalid — affects all logged-in users.
- `STRIPE_WEBHOOK_SECRET` is wrong — all webhooks fail with 400, all plan upgrades are silently dropped.
