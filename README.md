# SpectraCleanse AI

![Live](https://img.shields.io/badge/status-live-brightgreen)
![Pricing](https://img.shields.io/badge/pricing-free%20%7C%20%249.99%20%7C%20%2424.99-blue)
![Sign up](https://img.shields.io/badge/sign%20up-spectracleanse.com-cyan)

**SpectraCleanse AI strips AI provenance markers and injects SEO metadata to beat algorithmic suppression.**

Upload your audio or video file, choose a platform preset, and SpectraCleanse AI will forensically wipe every embedded tag that signals AI-generated origin — then inject clean, platform-optimised metadata powered by Gemini to maximise your reach on YouTube, Spotify, Apple Music, TikTok, and beyond.

---

## Try it free

→ **[spectracleanse.com](https://spectracleanse.com)**

No credit card required. Free accounts include 3 files per month. Upgrade to Creator ($9.99/mo) or Studio ($24.99/mo) for unlimited processing and batch uploads.

---

## How it works

1. **Upload** — drag in any MP3, WAV, FLAC, M4A, or MP4 file (up to 500 MB).
2. **Analyse** — the forensic engine reads every embedded tag and identifies provenance markers.
3. **Cleanse** — a nuclear wipe removes all XMP, IPTC, and ID3 fields that could trigger algorithmic detection.
4. **Inject** — Gemini generates an SEO-optimised title, description, and tag set tuned to your chosen platform.
5. **Download** — receive a clean file with a full forensic report showing exactly what was removed.

---

## Open source

The source code is available at [github.com/ChrisAdamsdevelopment/SpectraCleanseAI](https://github.com/ChrisAdamsdevelopment/SpectraCleanseAI) and is released under the [MIT License](LICENSE). You are free to self-host, fork, or contribute.

---

## Local development notes

- Backend defaults to developer-friendly mode when `NODE_ENV` is not `production`.
- If Stripe env vars are missing locally, `/api/create-checkout-session` can return a mock checkout redirect (set `ENABLE_MOCK_CHECKOUT=true`).
- In production, Stripe variables are still required and the server will fail fast if they are missing.

---

## Contact

Questions, partnerships, or enterprise enquiries: [hello@spectracleanse.com](mailto:hello@spectracleanse.com)
