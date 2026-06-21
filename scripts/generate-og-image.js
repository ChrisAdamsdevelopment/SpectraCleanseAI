#!/usr/bin/env node
// Render public/assets/og-image.png (1200x630) for social previews.
// Runs at install time / dev — output is committed to the repo.

const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

const OUTPUT = path.join(__dirname, '..', 'public', 'assets', 'og-image.png');
const WIDTH = 1200;
const HEIGHT = 630;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0F172A"/>
      <stop offset="100%" stop-color="#0B2540"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#06B6D4"/>
      <stop offset="100%" stop-color="#2563EB"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>
  <rect x="0" y="0" width="12" height="${HEIGHT}" fill="url(#accent)"/>

  <g transform="translate(80, 180)">
    <text font-family="Segoe UI, Helvetica, Arial, sans-serif" font-weight="800" font-size="84" fill="#F8FAFC">SpectraCleanse</text>
    <text y="80" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-weight="500" font-size="36" fill="#94A3B8">Strip AI Markers. Inject Real Metadata.</text>
    <text y="140" font-family="Segoe UI, Helvetica, Arial, sans-serif" font-weight="500" font-size="22" fill="#67E8F9">Beat algorithmic suppression on Spotify, YouTube, Apple Music, TikTok.</text>
  </g>

  <g transform="translate(820, 360)" stroke="#67E8F9" stroke-width="6" stroke-linecap="round" fill="none">
    <line x1="0" y1="60" x2="0" y2="-60"/>
    <line x1="40" y1="120" x2="40" y2="-120"/>
    <line x1="80" y1="40" x2="80" y2="-40"/>
    <line x1="120" y1="100" x2="120" y2="-100"/>
    <line x1="160" y1="20" x2="160" y2="-20"/>
    <line x1="200" y1="80" x2="200" y2="-80"/>
    <line x1="240" y1="50" x2="240" y2="-50"/>
  </g>

  <g transform="translate(80, ${HEIGHT - 70})">
    <text font-family="Segoe UI, Helvetica, Arial, sans-serif" font-weight="500" font-size="22" fill="#64748B">spectracleanse.com</text>
  </g>
</svg>
`;

(async () => {
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(OUTPUT);
  const stat = fs.statSync(OUTPUT);
  console.log(`og-image: ${OUTPUT} (${stat.size} bytes)`);
})().catch((err) => {
  console.error('og-image generation failed:', err);
  process.exit(1);
});
