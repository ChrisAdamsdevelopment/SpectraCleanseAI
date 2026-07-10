# Feature Flags & Safe Migration

This document describes how the trust/compliance overhaul ships **without ever
putting the live product at risk**. The guiding rule: production on `main` is
always a known-good fallback, and every new capability is reversible two ways.

---

## Ethos

SpectraCleanse's identity does not change: **freedom, control, knowledge, and
power over your own files.** The platform gives the creator the knowledge and
the capability; the creator decides how to use it. The new trust/compliance
features (disclosure, rights, verification, readiness) are simply *more* of that
control surfaced — not a different product.

---

## Two independent safety nets

1. **Per-commit image rollback.** CD tags every Docker image with the commit SHA
   (`spectracleanse-api:<sha>`) as well as `:latest`
   (`.github/workflows/cd.yml`). Rolling back = redeploy a prior SHA tag. This
   already exists.
2. **Feature flags (disable without redeploy).** New code ships to production
   *dark* — deployed but inert — behind the `FEATURES` env var. Flipping a flag
   on/off is an env change, not a code deploy.

Together: if a new feature misbehaves, turn its flag off instantly; if the build
itself is bad, redeploy the previous SHA.

---

## Branch & environment model

```
feature branch  ──►  develop  ──►  main
                      │             │
                   staging        production
              (staging.yml,    (cd.yml → Hyperlift)
            CI/CD Pipeline)
```

- All overhaul work starts on a feature branch off `main`.
- Merge to `develop` → auto-builds a `staging-*` image and runs a health smoke
  test against staging (`.github/workflows/staging.yml`). Validate features here
  with their flags **on**.
- Promote to `main` only after staging passes. In production the flags stay
  **off** until you deliberately enable them.

`main` is never the place where unproven features are first exercised.

---

## How the flags work

Single source of truth: the comma-separated `FEATURES` env var.

```
FEATURES=chain_of_custody,release_readiness
```

- Backend: `server/featureFlags.js` — `getEnabledFeatures()`, `isFeatureEnabled(name)`.
- Frontend (build-time): `VITE_FEATURES`, parsed by `src/utils/featureFlags.ts`.
- Frontend (runtime): `GET /api/features` returns the live enabled list, so the
  server can turn a feature on without a frontend rebuild.

Rules:
- **Empty by default.** No `FEATURES` set ⇒ the app behaves exactly like the
  current production release.
- **Unknown names are ignored.** A typo can never enable an unexpected surface.
- **Never gate auth, billing, or the existing cleanse path on a flag.** Flags
  guard *new, additive* code only. The known-good flow must keep working even if
  every flag is off (or on).

Register a flag in `KNOWN_FEATURES` (in both files) before gating code on it.

---

## Adding a feature safely (checklist)

1. Add the flag name to `KNOWN_FEATURES` in `server/featureFlags.js` and
   `src/utils/featureFlags.ts`.
2. Build the new endpoints/tables/UI as **additive** — do not modify existing
   routes, schema columns, or the cleanse pipeline in place.
3. Gate every new surface behind `isFeatureEnabled('<flag>')`.
4. Land on a feature branch → `develop`; validate on staging with the flag on.
5. Promote to `main` with the flag **off** in production.
6. Enable in production by setting `FEATURES` when you're ready — and be able to
   unset it just as fast.
