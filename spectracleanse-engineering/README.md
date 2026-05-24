# SpectraCleanse Engineering Plugin

A Claude plugin built specifically for engineering work on [SpectraCleanse](https://spectracleanse.com) — the AI-provenance-marker cleansing and SEO metadata injection tool for audio and video files.

This plugin is **not** a generic engineering assistant. Every skill, checklist, and doc in here is calibrated to the actual SpectraCleanse repo: its stack, endpoints, deployment model, risk surfaces, and founder workflow.

---

## What this plugin helps with

| Skill | When to use it |
|---|---|
| `spectracleanse-code-review` | Reviewing changes to server.js, app.tsx, cleansePolicy.js, processor.js |
| `spectracleanse-architecture` | Making architectural decisions: storage, auth upgrades, queue, API split |
| `spectracleanse-deploy-readiness` | Pre-deploy gate checks for Render/Hyperlift releases |
| `spectracleanse-processing-pipeline` | Reviewing or designing file-processing and ExifTool behavior |
| `spectracleanse-auth-billing` | Debugging JWT, /api/me, 402 upgrade flow, Stripe checkout |
| `spectracleanse-incident-response` | Production triage: broken deploy, CORS failure, Gemini outage |
| `spectracleanse-documentation` | Writing accurate README, env, API, or user-facing docs |
| `spectracleanse-testing-strategy` | Designing smoke tests, CI gates, and integration test fixtures |
| `spectracleanse-founder-operating-review` | Solo-founder shipping review: what shipped, risks, next move |

---

## What this plugin does NOT do

- It does not auto-deploy to Render or Hyperlift.
- It does not store or handle real API keys, secrets, or webhook secrets.
- It does not claim format support without verifying from `server/cleansePolicy.js`.
- It does not execute live Stripe or Gemini calls.
- It does not replace the manual QA checklist in `docs/manual-qa-checklist.md`.

---

## Stack reference (confirmed from repo)

- **Frontend**: React 18 + Vite 4, TypeScript 5, Tailwind CSS 3, `lucide-react`
- **Backend**: Node.js 20.20.2, Express 4, `server.js` as entrypoint
- **Database**: SQLite via `better-sqlite3` 9, WAL mode, tables: `users`, `jobs`
- **Media processing**: `exiftool-vendored` 28, `music-metadata` 11, `browser-id3-writer` (browser-side MP3)
- **AI**: Google Gemini `gemini-2.5-flash` via REST (`/api/generate-seo`)
- **Billing**: Stripe 16, subscription checkout, webhook at `/api/stripe-webhook`
- **Auth**: email/password + bcrypt, JWT 7-day expiry, Bearer token
- **Frontend env var**: `VITE_API_URL` (used in `app.tsx`) — note: `.env.example` lists `VITE_API_URL` but the frontend reads `VITE_API_URL`
- **Deployment**: Render / Spaceship Hyperlift (both documented); Docker support present

---

## Installation / local testing

See `docs/plugin-validation.md` for full instructions.

Quick start:
```bash
# From repo root, point Claude at this plugin directory
claude --plugin-dir ./spectracleanse-engineering
```

Or reference it in your `.claude/settings.json`:
```json
{
  "pluginDirs": ["./spectracleanse-engineering"]
}
```

---

## Agents

- **spectracleanse-repo-researcher** — read-only repo exploration; finds actual files, endpoints, env vars before any claim is made
- **spectracleanse-incident-commander** — production triage; ranks hypotheses, separates facts from guesses, focuses on user impact first

---

## MCP roadmap

See `docs/mcp-roadmap.md`. Short version:
1. Remote SpectraCleanse Admin MCP (deploy health, env validation, smoke checks, usage stats)
2. GitHub MCP (issues, PRs, commit context)
3. Sentry MCP (if/when error monitoring is configured)
4. Playwright MCP (UI smoke tests)

---

## Safety / security notes

- No real secrets are stored in this plugin. `.mcp.json.example` uses placeholders only.
- Never commit a real `.mcp.json` (containing live tokens) to version control.
- All documented endpoints and env vars are verified from the repo. If the repo changes, update this plugin.
- Skills marked `conservative` will not suggest auto-running risky operations.

---

## Keeping this plugin current

When you make significant changes to SpectraCleanse, update:

| Change | Update |
|---|---|
| New API endpoint | `docs/product-context.md`, `spectracleanse-code-review/SKILL.md` |
| New env var | `docs/env-and-secrets-reference.md`, `spectracleanse-deploy-readiness/SKILL.md` |
| Format support change | `docs/supported-formats-and-processing-boundaries.md`, `spectracleanse-processing-pipeline/SKILL.md` |
| New plan tier | `spectracleanse-auth-billing/SKILL.md`, `docs/product-context.md` |
| New deployment platform | `docs/render-deploy-checklist.md`, `spectracleanse-deploy-readiness/SKILL.md` |
| Gemini model change | `spectracleanse-processing-pipeline/SKILL.md`, `docs/product-context.md` |
