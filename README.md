# SpectraCleanse AI

<p align="center">
  <img src="https://img.shields.io/badge/status-active-brightgreen" alt="Status">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="License">
  <img src="https://img.shields.io/badge/framework-React%20%2B%20Node.js-61DAFB" alt="React">
  <img src="https://img.shields.io/badge/metadata-ExifTool-red" alt="ExifTool">
  <img src="https://img.shields.io/badge/platform-YouTube%20%7C%20Spotify%20%7C%20TikTok%20%7C%20Instagram-blueviolet" alt="Platforms">
</p>

**SpectraCleanse AI** is the only browser-based tool that **strips AI provenance markers** (C2PA, JUMBF, XMP, IPTC) from your audio and video files and **replaces them with high-performing SEO metadata** – all in one click. Built for creators who use Suno, Udio, Runway, and other AI tools, it defeats algorithmic suppression and puts your content back in front of the audience you deserve.

---

## 🎯 The Problem

YouTube, Spotify, TikTok, and Instagram now **automatically detect AI-generated content** and apply "Made with AI" labels, shadowbanning, and reduced reach. Creators report **50–80% fewer views** when these markers are present. Even a single edit in Adobe Firefly can embed a C2PA fingerprint that kills your video's performance.

---

## ✅ The SpectraCleanse Solution

- **Forensic Cleanse:** Removes all AI provenance metadata from MP4, MP3, M4A, WAV, and FLAC files using ExifTool.
- **SEO Injection:** Automatically writes platform‑optimized titles, descriptions, tags, and lyrics tailored for YouTube, Spotify, Apple Music, or TikTok.
- **Batch Processing:** Upload up to 20 files at once and process them in one click.
- **Verification Reports:** See exactly which tags were stripped and what SEO was injected – no guesswork.

---

## 💰 Monetization & Pricing

SpectraCleanse is **free to try** and scales with your needs. Every paid tier pays for itself by recovering lost views and the ad revenue that comes with them.

| Plan | Price | Cleanses | Best For |
|:---|:---|:---|:---|
| **Free** | $0/mo | 3 per month | Trying the tool, small channels |
| **Creator** | **$9.99/mo** | Unlimited | Prolific AI music makers, video creators |
| **Studio** | **$29.99/mo** | Unlimited + Deep Cleanse + API | Agencies, labels, content farms |
| **Enterprise** | Custom | Unlimited + white‑label | Distribution platforms, OEM integration |

> **Creator Tier alone pays for itself the moment your first video breaks out of the 50‑view algorithm jail.**

[Sign up and start cleansing →](https://spectracleanse.com)

---

## 🚀 Key Features

- 🧹 **Deep Metadata Wipe** – Strips C2PA, JUMBF, XMP, IPTC, EXIF, and software tracking data.
- 🤖 **AI‑Powered SEO** – Uses Gemini to generate keyword‑rich titles, descriptions, and 15+ tags.
- 🎛️ **Platform‑Specific Presets** – Optimize metadata for YouTube, Spotify, Apple Music, or TikTok with one click.
- 📦 **Batch Processing** – Queue up to 20 files and process them sequentially.
- 📋 **Forensic Audit Reports** – See exactly which tags were removed and what was injected.
- 🔒 **Secure API** – Your Gemini API key never touches the browser; all AI calls proxy through our backend.
- 🌐 **Browser‑Based** – No terminal, no ExifTool knowledge required.

---

## 🧱 How It Works

```
Upload file → Client‑side metadata analysis → AI SEO generation (Gemini)
→ Nuclear cleanse (ExifTool) → Platform‑specific SEO injection
→ Download cleansed file + forensic report
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|:---|:---|
| **Frontend** | React, TypeScript, Vite, Tailwind CSS |
| **Backend** | Node.js, Express, ExifTool‑vendored, Multer |
| **AI Integration** | Google Gemini 2.5 Flash (proxied) |
| **Metadata Parsing** | music‑metadata‑browser (audio), mp4box.js (video) |
| **Deployment** | Docker, Spaceship Hyperlift (or any Node.js host) |

---

## 📂 Getting Started

### Prerequisites
- Node.js ≥ 18
- npm
- Perl (required by ExifTool; included on most Linux/macOS systems)
- A Gemini API key from [Google AI Studio](https://aistudio.google.com/)

### Backend Setup

```bash
git clone https://github.com/your-org/spectracleanse.git
cd spectracleanse/backend
npm install
cp .env.example .env
# Edit .env with your GEMINI_API_KEY and desired ALLOWED_ORIGIN
npm run dev
```

### Frontend Setup

```bash
cd ../frontend
npm install
cp .env.local.example .env.local
# Set VITE_BACKEND_URL to http://localhost:3001 (or your deployed backend)
npm run dev
```

Visit `http://localhost:5173` and start cleansing.

---

## 📡 API Endpoints

| Endpoint | Method | Description |
|:---|:---|:---|
| `/api/health` | GET | Health check |
| `/api/generate-seo` | POST | Generate SEO metadata via Gemini |
| `/api/process` | POST | Upload file, strip metadata, inject SEO, return cleansed file |

---

## 🚢 Deployment

SpectraCleanse is designed for easy deployment on **Spaceship Hyperlift**, **Railway**, **Render**, or any Docker‑compatible host.

### Deploy with Spaceship Hyperlift (recommended)
1. Push your code to a GitHub repository.
2. In your Spaceship dashboard, open **Hyperlift** and connect your repo.
3. Deploy the `backend` directory as a **Medium** plan service.
4. Deploy the `frontend` directory (after building) as a static site, or use a second **Micro** plan service for the production build.
5. Set environment variables (`GEMINI_API_KEY`, `ALLOWED_ORIGIN`) in the Hyperlift dashboard.

Detailed Docker and deployment guides are available in [DEPLOY.md](DEPLOY.md).

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. SpectraCleanse is a community‑driven project supported by AI creators who want to keep the web open and fair.

---

## 📄 License

SpectraCleanse AI is released under the [MIT License](LICENSE). You are free to use, modify, and distribute it. See the license file for full details.

---

## 📬 Contact

For enterprise inquiries, API access, or partnership opportunities, email us at **hello@spectracleanse.com** or open an issue on GitHub.

---

*Built with ❤️ for creators who refuse to be silenced by an algorithm.*
