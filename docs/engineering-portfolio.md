# SpectraCleanseAI: full-stack AI product engineering

**Focus:** React, TypeScript, Node.js/Express, SQLite, authentication, AI API integration, billing, media-processing workflows, Docker and test/release engineering.

SpectraCleanseAI is a web application for analyzing and editing embedded audio/video metadata and generating AI-assisted descriptive metadata. Some operations intentionally remove provenance-related embedded fields; this is a description of the actual product function, **not** a claim that all origins or content signals can be erased or that any platform will rank content differently.

## System areas to review

| System area | Technology or design | Inspectable starting point |
| --- | --- | --- |
| User interface | React, TypeScript, Vite | `src/`, `app.tsx` |
| API and backend | Node.js/Express routing and middleware | `server.js`, `server/` |
| Accounts and billing | JWT/authentication, SQLite and Stripe integration | Backend implementation and tests |
| Media processing | Client-side MP3 metadata editing and server-side MP4/M4A processing | `src/`, `server/`, [manual QA](manual-qa-checklist.md) |
| AI integration | Provider API for descriptive metadata suggestions | Application configuration and API handling |
| Deployment and quality | Docker, CI/test tooling, environment configuration | `Dockerfile`, `package.json`, [QA checklist](manual-qa-checklist.md) |

## Run and verify

From the project root, review `.env.example` for required configuration before starting a local development environment.

```bash
npm ci
npm run test:run
npm run build
```

Builds can depend on the documented Node version and native SQLite dependencies. Configure Stripe and provider API credentials only through appropriate private environment settings, not source code.

## Feature and release boundaries

- Public documentation currently distinguishes **browser-side MP3** handling from **server-side MP4/M4A** handling.
- Other media formats, provider routing and packaging/release gates vary by branch and must not be described as generally shipped features until verified.
- Removing metadata fields does not necessarily eliminate all provenance evidence, platform-side signals or detection mechanisms; SEO text suggestions do not guarantee reach or distribution.
- Development-mode mock billing is not evidence of successful live payment processing. Production claims should be backed by deployment and integration checks.

## What this project demonstrates to an engineering hiring team

End-to-end product architecture, user-facing UI, backend integration, stateful accounts and billing, media-processing error handling, automated testing and deployment configuration. A local alpha branch contains additional test-user and packaging work; those local changes are not automatically part of public `main`.

Recruiter demo suggestion: run a non-sensitive sample through the supported media pathway and show the frontend, API, actual result report and one automated test. Never use real customer files or secrets in a public demonstration.
