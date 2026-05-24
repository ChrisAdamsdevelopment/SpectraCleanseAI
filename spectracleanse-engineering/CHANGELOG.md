# Changelog – spectracleanse-engineering plugin

All changes to this plugin are documented here.

## [Unreleased]

### Added
- Created SpectraCleanse-specific engineering plugin scaffold (`spectracleanse-engineering/`)
- Plugin manifest (`.claude-plugin/plugin.json`) with 9 skills, 2 agents, 6 docs registered
- `spectracleanse-code-review` skill: upload/MIME/ExifTool/Gemini/auth/CORS/Stripe-aware code review
- `spectracleanse-architecture` skill: Render-constrained architecture decision framework
- `spectracleanse-deploy-readiness` skill: Render/Hyperlift pre-deploy checklist with env gate and smoke tests
- `spectracleanse-processing-pipeline` skill: format matrix, trust boundaries, ExifTool and browser-side cleanse review
- `spectracleanse-auth-billing` skill: JWT, /api/me, 402 upgrade, Stripe checkout, plan-desync debugging
- `spectracleanse-incident-response` skill: incident classes mapped to SpectraCleanse failure modes
- `spectracleanse-documentation` skill: accurate doc generation with current-vs-planned distinction
- `spectracleanse-testing-strategy` skill: test surface audit starting from current zero-test state
- `spectracleanse-founder-operating-review` skill: solo-founder shipping review replacing generic standups
- `spectracleanse-repo-researcher` agent: read-only repo exploration with citation discipline
- `spectracleanse-incident-commander` agent: production triage with hypothesis ranking
- `docs/product-context.md`: full stack reference with risk model and known assumptions
- `docs/render-deploy-checklist.md`: Render/Hyperlift-specific deploy checklist
- `docs/mcp-roadmap.md`: 3-phase MCP integration plan with Admin MCP tool spec
- `docs/supported-formats-and-processing-boundaries.md`: format matrix with verification instructions
- `docs/env-and-secrets-reference.md`: all env vars with types, roles, and Render notes
- `docs/plugin-validation.md`: local install and manual validation checklist
- `.mcp.json.example`: safe placeholder MCP config (no real secrets)
- `README.md`: plugin overview, stack reference, install instructions
- Documented VITE_API_URL vs VITE_BACKEND_URL discrepancy between app.tsx and .env.example
- Documented Node 18 in ci.yml vs Node 20.20.2 in .nvmrc — noted as known conflict

### Notes
- Initial version created from live repo inspection (May 2026)
- All stack facts verified from: `package.json`, `server.js`, `server/cleansePolicy.js`,
  `server/processor.js`, `app.tsx`, `.env.example`, `.nvmrc`, `.github/workflows/ci.yml`,
  `docs/manual-qa-checklist.md`, `PIPELINE.md`, `deploy.md`
