# SpectraCleanse MCP Integration Roadmap

This document describes the recommended MCP (Model Context Protocol) architecture for SpectraCleanse and the engineering plugin. It separates the three distinct MCP concerns and provides a phased implementation plan.

---

## The three MCP concerns for SpectraCleanse

| # | MCP | Purpose | Priority |
|---|---|---|---|
| 1 | **SpectraCleanse Admin MCP** | Remote MCP server backed by the Render deployment. Exposes deploy health, env validation, usage stats, smoke checks, and release note generation. | High — build first |
| 2 | **SpectraCleanse Engineering Plugin** | This plugin. Installs locally as a Claude plugin; provides skills for code review, deploy readiness, incident response, etc. | Already built |
| 3 | **Local ExifTool / Media MCP** (optional) | Local MCP for running ExifTool operations and inspecting real media files during development. Only useful if working with local test fixtures. | Low priority |

---

## Phase 1: SpectraCleanse Admin MCP (build this first)

### What it is
A remote MCP server that runs as a service (can be a separate Express route on the SpectraCleanse backend, or a separate service) and exposes structured tools for Claude to query the live deployment state.

### Why remote, not local
- The production DB, upload state, and deploy health are on Render — not on the developer's machine.
- A remote MCP can query the live DB, run health checks, and read Render env state from wherever Claude is running.
- No secrets are stored in the plugin — the MCP server handles authentication server-side.

### Tool surface (spec — not yet implemented)

```typescript
// get_deploy_health
// Returns: { status: 'ok'|'degraded', nodeVersion, dbConnected, exiftoolRunning, uptime }
get_deploy_health(): DeployHealth

// validate_env
// Returns: { missing: string[], misconfigured: string[], ok: string[] }
// Checks all required env vars are present and correctly formatted
validate_env(): EnvValidation

// run_smoke_checks
// Returns: { checks: { name: string, passed: boolean, detail: string }[] }
// Runs /api/health, /api/me auth check, and a minimal format rejection check
run_smoke_checks(): SmokeCheckResults

// list_recent_processing_failures
// Returns: last N failed processing attempts (from a future error log table)
// Current: not tracked in DB — would require adding an error_log table
list_recent_processing_failures(limit?: number): ProcessingFailure[]

// get_checkout_failures
// Returns: Stripe checkout sessions where userId was missing or plan update failed
// Current: not tracked — would require a billing_events table
get_checkout_failures(since?: string): CheckoutFailure[]

// get_usage_and_plan_stats
// Returns: { totalUsers, freeUsers, creatorUsers, studioUsers, jobsThisMonth, jobsAllTime }
get_usage_and_plan_stats(): UsageStats

// list_supported_formats
// Returns: the current CLEANSE_POLICY from cleansePolicy.js as structured data
list_supported_formats(): FormatPolicy

// draft_release_notes_from_commits
// Returns: AI-drafted release notes from recent git commits
// Requires: GitHub MCP or git access
draft_release_notes_from_commits(since?: string): string
```

### Implementation notes
- The Admin MCP should require authentication (Bearer token or API key) — store this as `ADMIN_MCP_SECRET` in the Render env, never in the plugin.
- `get_usage_and_plan_stats` and `list_recent_processing_failures` can query the existing `users` and `jobs` tables immediately.
- `get_checkout_failures` and `list_recent_processing_failures` need new DB tables to be useful — this is future work.
- Use the `@modelcontextprotocol/sdk` Node.js package or expose via an HTTP endpoint that Claude can query.

### Minimal first implementation
1. Add `/admin/health` route to `server.js` (auth-gated)
2. Return `{ nodeVersion, dbConnected, uptime, planStats, jobsThisMonth }`
3. Register this as an MCP tool in `.mcp.json`
4. Test that Claude can query it during an incident response session

---

## Phase 2: GitHub MCP (connect when repo is on GitHub)

### What it provides
- Read commits, PRs, issues from `github.com/ChrisAdamsdevelopment/SpectraCleanseAI`
- Draft release notes from commit history
- Surface open issues during founder operating review
- Check CI status for the last push to `main`

### Setup
```json
// .mcp.json (never commit with real token)
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "REPLACE"
      }
    }
  }
}
```

### Tools to use during skills
- `get_file_contents` — verify actual endpoint names / env vars before making claims
- `list_commits` — populate "Shipped" section of founder operating review
- `list_pull_requests` — check for open PRs during deploy readiness gate
- `get_issue` — surface known bugs during incident triage

---

## Phase 3: Sentry MCP (add if/when Sentry is configured)

### What it provides
- Production error rates and stack traces during incident response
- Alert history for /api/process, /api/generate-seo failures
- Top errors by volume

### Setup
```json
{
  "mcpServers": {
    "sentry": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sentry"],
      "env": {
        "SENTRY_AUTH_TOKEN": "REPLACE",
        "SENTRY_ORG": "REPLACE",
        "SENTRY_PROJECT": "spectracleanse"
      }
    }
  }
}
```

Note: Sentry is not currently configured in SpectraCleanse. This is Phase 3 — do not set up until Phase 1 Admin MCP provides baseline observability.

---

## Phase 4: Playwright MCP (optional, for UI smoke test automation)

### What it provides
- End-to-end browser automation for the upload → process → download flow
- Automated upgrade modal trigger testing
- Cross-browser format rejection verification

### Setup
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@playwright/mcp"],
      "env": {
        "PLAYWRIGHT_BASE_URL": "https://spectracleanse.com"
      }
    }
  }
}
```

---

## Security notes

- Never store real tokens or API keys in this plugin directory or any committed `.mcp.json`.
- The Admin MCP secret (`ADMIN_MCP_SECRET`) must be rotatable independently from `JWT_SECRET`.
- The Admin MCP must enforce auth on every tool call — do not expose usage stats or processing failure data without authentication.
- For local development: copy `.mcp.json.example` to `.mcp.json`, fill in test credentials, add `.mcp.json` to `.gitignore`.

---

## Implementation sequence

```
Week 1: Add /admin/health route to server.js (auth-gated)
         → Test manually via curl
         → Connect to Claude via .mcp.json

Week 2: Add get_usage_and_plan_stats tool
         → Useful for founder operating review

Week 3: Connect GitHub MCP
         → Use list_commits in founder operating review

Month 2: Add Sentry (if error monitoring is configured)
          Add Playwright MCP (if UI test automation is prioritized)

Month 3: Implement full Admin MCP tool surface
          (list_recent_processing_failures requires new DB table)
```
