# SpectraCleanse – Supported Formats and Processing Boundaries

This document describes what file formats are actually supported, where processing happens, and how to verify claims from the codebase. Do not update user-facing docs or claim format support without checking the sources listed here.

---

## Authoritative sources

To verify format support, always read these files in this order:

1. **`server/cleansePolicy.js`** — defines `CLEANSE_POLICY`. This is the single source of truth for server-side format support. If a format is not in `CLEANSE_POLICY.server.supportedExtensions`, it is not supported by Full Server Cleanse.

2. **`server.js` — `ALLOWED_MIME` constant** — defines the MIME types Multer will accept for upload. A format being in `ALLOWED_MIME` does not mean it is processable — it only means Multer won't reject the upload.

3. **`server/processor.js` — `isServerSupportedFormat()` call** — the processor checks the format after upload. If the format is not in `cleansePolicy.js`, `processMediaFile()` throws an `unsupportedCleanseError` (HTTP 422).

4. **`app.tsx`** — for Quick Cleanse (browser-side) format support. Look for `browser-id3-writer` usage and `music-metadata` parsing calls.

---

## Current format matrix (confirmed May 2026)

### Full Server Cleanse (`POST /api/process`, `POST /api/process-batch`)

| Format | Extension(s) | MIME accepted by Multer | Processor outcome | HTTP on rejection |
|---|---|---|---|---|
| MP4 | `.mp4` | `video/mp4`, `audio/mp4` | ✅ Processed | — |
| M4A | `.m4a` | `audio/mp4`, `audio/m4a`, `audio/x-m4a` | ✅ Processed | — |
| MP3 | `.mp3` | `audio/mpeg` | ❌ 422 — use Quick Cleanse | 422 `unsupported_file_type` |
| WAV | `.wav` | `audio/wav`, `audio/x-wav` | ❌ 422 | 422 `unsupported_file_type` |
| FLAC | `.flac` | `audio/flac`, `audio/x-flac` | ❌ 422 | 422 `unsupported_file_type` |
| Other | any | Not accepted | ❌ 415 | 415 (Multer MIME filter) |

**Source**: `CLEANSE_POLICY.server.supportedExtensions = ['.mp4', '.m4a']` in `server/cleansePolicy.js`.

### Quick Cleanse — browser-side (`app.tsx`)

| Format | Supported | Library | Notes |
|---|---|---|---|
| MP3 | ✅ | `browser-id3-writer` | ID3 tags written/cleared in browser. No server upload. |
| Other | ❌ | — | `music-metadata` may parse for analysis but no write support |

**Source**: `browser-id3-writer` import and usage in `app.tsx`. `music-metadata` is used for metadata analysis/display only.

### SEO generation (`POST /api/generate-seo`)

Format-agnostic — accepts any metadata payload. The endpoint does not receive a file; it receives structured metadata fields (title, artist, genre, etc.) and sends them to Gemini. Any format can use SEO generation as long as the metadata is provided.

### Batch processing (`POST /api/process-batch`)

Same format support as Full Server Cleanse (MP4, M4A). Batch is restricted to paid plans (creator, studio). Free users receive HTTP 403.

---

## Processing pipeline boundaries

```
                    ┌─────────────────────────────────┐
                    │           User uploads file      │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │    Multer MIME filter             │
                    │    (ALLOWED_MIME set in server.js)│
                    │    Rejects if MIME not in set → 415│
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │    Plan enforcement              │
                    │    Free: limit 3/month → 402    │
                    │    Batch free: → 403             │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │    isServerSupportedFormat()     │
                    │    cleansePolicy.js check        │
                    │    Unsupported → 422             │
                    └────────────────┬────────────────┘
                                     │ (MP4, M4A only)
                    ┌────────────────▼────────────────┐
                    │    processMediaFile()            │
                    │    (server/processor.js)         │
                    │    1. detectMarkers() (pre-wipe) │
                    │    2. ExifTool wipe all tags     │
                    │    3. Zero QuickTime timestamps  │
                    │    4. buildMetaToWrite() inject  │
                    │    5. verifyFinalState()          │
                    │    6. Compute SHA-256            │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │    res.download() output file    │
                    │    + X-Forensic-* headers        │
                    │    + Cleanup input + output      │
                    └─────────────────────────────────┘
```

---

## What gets removed (Full Server Cleanse, MP4/M4A)

All ExifTool-readable tags are wiped in a first pass. After the wipe:
- Tags matching `isBenign()` (file system metadata, technical container info) are left as-is
- Tags matching `isAllowedInjected()` (tags SpectraCleanse intentionally writes back) are expected to be present
- QuickTime timestamp fields (`CreateDate`, `ModifyDate`, `TrackCreateDate`, `TrackModifyDate`, `MediaCreateDate`, `MediaModifyDate`) are zeroed to `0000:00:00 00:00:00`
- All other descriptive and provenance-bearing tags are removed

**Source**: `server/metadataRules.js` for `isBenign`, `isAllowedInjected`, `MARKER_RULES`; `server/processor.js` for `QUICKTIME_TIMESTAMP_FIELDS`.

---

## What gets written back (Full Server Cleanse, MP4/M4A)

From user-supplied metadata via `buildMetaToWrite()` in `server/processor.js`:
- `ItemList:Title`, `QuickTime:Title`, `Keys:Title`, `Keys:DisplayName`
- `ItemList:Artist`, `QuickTime:Artist`, `ItemList:Author`, `ItemList:AlbumArtist`, `Keys:Artist` (if artist provided)
- Additional fields for description, genre, copyright, producer, lyrics (see `buildMetaToWrite` for full list)

All values sanitized through `cleanText(value, maxLength)` before being passed to ExifTool.

---

## Known WAV/FLAC behavior

WAV and FLAC files are accepted by Multer (their MIME types are in `ALLOWED_MIME`) but are rejected by the processor with HTTP 422. This means:
- The file IS uploaded to the server and written to `uploads/`
- The file is then immediately deleted after the 422 is returned
- The user sees: "Full Server Cleanse currently supports MP4 and M4A only. Use Quick Cleanse (Browser) for MP3, or convert WAV/FLAC to M4A/MP4."

**Implication**: WAV/FLAC uploads waste user bandwidth. A future improvement could reject these at the MIME filter level with a more helpful error message, or add ExifTool-based WAV/FLAC support to `cleansePolicy.js`.

---

## How to add a new format (procedure)

Before adding support for a new format:
1. Verify ExifTool can reliably read AND write that format without data loss: `exiftool -listw -f -FORMAT`
2. Create a test fixture: a real file of that format with known metadata embedded
3. Test `processMediaFile()` against the fixture manually
4. If successful, add the extension to `CLEANSE_POLICY.server.supportedExtensions` in `cleansePolicy.js`
5. Add the MIME type to `ALLOWED_MIME` in `server.js`
6. Update `isServerSupportedFormat()` in `cleansePolicy.js` if MIME alias handling is needed
7. Update user-facing error messages if the rejection message lists specific supported formats
8. Update this document and `docs/product-context.md`

Do not add a format to `ALLOWED_MIME` without also adding it to `cleansePolicy.js` — this would cause uploads to succeed but processing to fail with 422.
