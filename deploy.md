# Deploying SpectraCleanse AI on Spaceship Hyperlift

This guide walks through deploying the SpectraCleanse AI backend on the Spaceship Hyperlift Medium plan (1 vCPU, 2 GB RAM) from a fresh fork to a live HTTPS endpoint.

---

## Prerequisites

- A [Spaceship](https://spaceship.com) account with Hyperlift enabled
- A [Stripe](https://stripe.com) account with a live-mode secret key, a configured webhook, and two subscription price IDs (Creator and Studio)
- A Google Cloud / AI Studio account with a Gemini API key
- Your custom domain (`spectracleanse.com`) added to your DNS provider

---

## Step 1 — Fork the repository

1. Go to [github.com/ChrisAdamsdevelopment/SpectraCleanseAI](https://github.com/ChrisAdamsdevelopment/SpectraCleanseAI).
2. Click **Fork** and create a copy under your own GitHub account.
3. Clone your fork locally if you need to make any changes before deploying.

The repository already contains the `Dockerfile` and `hyperlift.toml` that Hyperlift needs — no further changes are required for a standard deployment.

---

## Step 2 — Add secrets in the Hyperlift dashboard

Hyperlift injects secrets at runtime so they never appear in your image or repository.

1. In the Hyperlift dashboard, open your project (or create a new one) and go to **Settings → Environment Variables**.
2. Add each of the following as a **secret** (encrypted at rest):

| Variable | Where to find it |
|---|---|
| `JWT_SECRET` | Generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"` |
| `STRIPE_SECRET_KEY` | Stripe Dashboard → Developers → API keys → Secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard → Developers → Webhooks → Signing secret |
| `STRIPE_CREATOR_PRICE_ID` | Stripe Dashboard → Products → Creator plan → Price ID |
| `STRIPE_STUDIO_PRICE_ID` | Stripe Dashboard → Products → Studio plan → Price ID |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) → Create API key |

3. Add the following as plain (non-secret) environment variables:

| Variable | Value |
|---|---|
| `PORT` | `3001` |
| `FRONTEND_URL` | `https://spectracleanse.com` |
| `DB_PATH` | `/data/spectra.db` |
| `NODE_ENV` | `production` |

---

## Step 3 — Create a service pointing to the Dockerfile

1. In the Hyperlift dashboard, click **New Service**.
2. Select **Docker** as the build type.
3. Connect your GitHub account and choose your forked `SpectraCleanseAI` repository.
4. Set the **build context** to `.` (the repository root) and the **Dockerfile path** to `Dockerfile`.
5. Set the **exposed port** to `3001`.
6. Under **Resources**, choose the **Medium** plan (1 vCPU, 2 GB RAM).
7. Under **Volumes**, attach a persistent volume mounted at `/data` with at least 10 GB. This is where the SQLite database lives — without a persistent volume, your user data will be lost on every deploy.
8. Click **Deploy**. Hyperlift will pull the repository, build the image, install Perl and Node dependencies, and start the container. The first build typically takes 2–4 minutes.
9. Once the deploy shows a green **Healthy** status, verify the backend is running by visiting `https://<your-hyperlift-domain>/api/health` — you should receive `{"status":"ok"}`.

---

## Step 4 — Map your custom domain and enable SSL

1. In the Hyperlift dashboard, go to your service → **Domains**.
2. Click **Add custom domain** and enter `spectracleanse.com` (and optionally `www.spectracleanse.com`).
3. Hyperlift will display a CNAME or A record target. Log in to your DNS provider and create the appropriate record pointing `spectracleanse.com` to that target.
4. DNS propagation typically takes 5–30 minutes. Once Hyperlift detects the record, it will automatically provision a Let's Encrypt TLS certificate and enable HTTPS. No manual certificate management is required.
5. After SSL is active, update your Stripe webhook endpoint URL (Stripe Dashboard → Developers → Webhooks) from any temporary domain to `https://spectracleanse.com/api/stripe-webhook`.

---

## Step 5 — Deploy the frontend

The React frontend (`app.tsx`) is a separate Vite build. Before building, set the following environment variable in your frontend build environment:

```
VITE_BACKEND_URL=https://spectracleanse.com
```

Build the frontend with `vite build` and deploy the resulting `dist/` directory to any static host (Cloudflare Pages, Netlify, Vercel, or Hyperlift Static). Point it at the same custom domain or a subdomain of your choice.

---

## Redeployments

Hyperlift automatically triggers a new build whenever you push to the default branch of your connected repository. To deploy manually, click **Redeploy** in the service dashboard. Zero-downtime rolling deploys are enabled by default on the Medium plan.

---

## Support

For deployment issues, contact [hello@spectracleanse.com](mailto:hello@spectracleanse.com) or open an issue on [GitHub](https://github.com/ChrisAdamsdevelopment/SpectraCleanseAI).
