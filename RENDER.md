# Deploying SpectraCleanse AI on Render

This is the complete environment-variable reference and setup guide for running
SpectraCleanse AI on [Render](https://render.com). It explains why Stripe and
email verification may appear "not working" and exactly how to fix it.

## Why Stripe / email verification aren't working

The server changes behavior based on `NODE_ENV` and which secrets are present:

- **If `NODE_ENV` is NOT `production`** the server enables **mock checkout**
  (Stripe is bypassed and returns a fake success URL — no real charge) and
  **dev-fallback email** (verification/reset emails are only logged, never
  sent). This is almost always the cause of "Stripe and email aren't working."
- **If `NODE_ENV` is `production` but Stripe vars are missing**, the server
  exits on boot with `FATAL: Stripe is not fully configured in production.`
- **If SMTP vars are missing in production**, account creation still works but
  verification/reset emails fail to send.

After deploying, open your Render service **Logs** and look for the
`[Config]` summary printed at startup — it tells you whether Stripe and Email
are actually live or running in mock/fallback mode.

## Required environment variables

Set these in **Render → your service → Environment**. (If you deploy via the
included `render.yaml` blueprint, the keys are pre-created and you just fill in
the secret values.)

### Core

| Variable | Required | Value / Notes |
|---|---|---|
| `NODE_ENV` | ✅ | `production` — **this is the single most important one.** Turns off mock checkout and dev-email fallback. |
| `JWT_SECRET` | ✅ | A long random string. Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `FRONTEND_URL` | ✅ | Your public URL, e.g. `https://spectracleanseai.onrender.com`. Used for CORS, Stripe redirect URLs, and email links. |
| `DB_PATH` | ✅ | `/data/spectra.db` — must point at a **persistent disk** or data is wiped on every deploy. |
| `PORT` | Auto | Render injects this automatically; the server reads it. Do not hard-code. |
| `APP_BASE_URL` | Optional | Base URL for email links. Falls back to `FRONTEND_URL`, so usually unnecessary. |
| `ALLOWED_ORIGINS` | Optional | Comma-separated extra CORS origins. Only needed if the frontend is on a different domain than the API. |

### Stripe — all four required for live checkout

| Variable | Where to find it |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys → Secret key (`sk_live_…`) |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Developers → Webhooks → your endpoint → Signing secret (`whsec_…`) |
| `STRIPE_CREATOR_PRICE_ID` | Stripe → Products → Creator plan → Price ID (`price_…`) |
| `STRIPE_STUDIO_PRICE_ID` | Stripe → Products → Studio plan → Price ID (`price_…`) |

If **any** of these four is missing, the server treats Stripe as unconfigured.

### Email / SMTP — all five required to send mail

| Variable | Notes |
|---|---|
| `SMTP_HOST` | e.g. `smtp.sendgrid.net`, `smtp.resend.com`, `smtp.gmail.com` |
| `SMTP_PORT` | `587` (STARTTLS) or `465` (implicit TLS) |
| `SMTP_USER` | SMTP username (for SendGrid the literal string `apikey`) |
| `SMTP_PASS` | SMTP password / API key |
| `SMTP_FROM` | From address, e.g. `SpectraCleanse <no-reply@spectracleanse.com>` |

If **any** of these five is missing, verification/reset emails won't send in production.

### Optional

| Variable | Notes |
|---|---|
| `GEMINI_API_KEY` | Only needed for the AI SEO-generation feature. |
| `VITE_API_URL` | Build-time only. Leave **unset** for the default same-origin deployment. Set it only if you host the frontend separately from the API. |

## Setup steps

1. **Create the service.** Use the included `render.yaml` (New → Blueprint) or
   create a Web Service with **Runtime: Docker** pointing at this repo's
   `Dockerfile`.
2. **Add a persistent disk** mounted at `/data` (≥1 GB) so the SQLite database
   survives deploys. Set `DB_PATH=/data/spectra.db`.
3. **Fill in all environment variables** from the tables above.
4. **Deploy**, then check `https://<your-service>.onrender.com/api/health` →
   `{"status":"ok"}`.
5. **Configure the Stripe webhook.** In Stripe → Developers → Webhooks, add an
   endpoint at `https://<your-service>.onrender.com/api/stripe-webhook` and
   subscribe to `checkout.session.completed` and `customer.subscription.deleted`.
   Copy its signing secret into `STRIPE_WEBHOOK_SECRET` and redeploy.
6. **Verify the logs.** The startup `[Config]` lines should show Stripe and
   Email as `configured`.

## Quick checklist

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` set to a strong random value
- [ ] `FRONTEND_URL` = your Render URL
- [ ] Persistent disk at `/data` + `DB_PATH=/data/spectra.db`
- [ ] All 4 `STRIPE_*` vars set
- [ ] Stripe webhook endpoint created and `STRIPE_WEBHOOK_SECRET` set
- [ ] All 5 `SMTP_*` vars set
- [ ] `/api/health` returns ok and logs show Stripe + Email `configured`
