# spectracleanse-processing-pipeline

**Use this skill when reviewing, debugging, or designing SpectraCleanse's file-processing behavior** — format support decisions, ExifTool operations, browser-side vs. server-side cleanse, metadata removal and re-injection, SEO generation, and verification output.

---

## SpectraCleanse context (confirmed from repo)

### Processing modes

**Quick Cleanse (browser-side)**
- Runs entirely in the browser — no file is uploaded to the server.
- Only supported format: `.mp3` (via `browser-id3-writer`).
- Metadata analysis uses `music-metadata` with graceful parseError fallback.
- No ExifTool involved. No server processing. No job recorded in the DB.
- File size limit is browser memory, not the 500 MB server limit.

**Full Server Cleanse (`/api/process`)**
- File is uploaded via Multer to `uploads/` on the server.
- Supported formats: `.mp4`, `.m4a` only (defined in `server/cleansePolicy.js` `CLEANSE_POLICY.server.supportedExtensions`).
- MIME accept-list (Multer): `audio/mpeg`, `audio/wav`, `audio/x-wav`, `audio/flac`, `audio/x-flac`, `audio/mp4`, `audio/m4a`, `video/mp4`.
- ⚠️ Multer accepts WAV and FLAC MIME types but the processor rejects them with HTTP 422. This means WAV/FLAC files are uploaded, then rejected — wasting bandwidth and disk I/O until deletion.
- Processing: `server/processor.js` → `exiftool-vendored` (wraps ExifTool Perl CLI).
- Plan enforcement: free users capped at 3 files/month. 402 returned if limit exceeded.
- Output file: cleansed copy returned via `res.download()`, then deleted immediately.
- Job recorded in `jobs` table for usage counting.

**Batch processing (`/api/process-batch`)**
- Paid plans (creator, studio) only. Free plans receive HTTP 403.
- Up to 20 files per request. 2 GB total batch size guard.
- Processing is sequential (not parallel) within one request.
- Each output file gets a one-time download token (`server/downloadTokens.js`).
- Download via `GET /api/download/:token` (authenticated, single-use).

**SEO generation (`/api/generate-seo`)**
- Separate from processing — can be called independently.
- Sends a prompt to `gemini-2.5-flash` via the Generative Language REST API.
- Structured JSON output: `{ title: string, description: string, tags: string }`.
- Prompt is built by `buildSeoPrompt()` from user-supplied fields: title, artist, genre, platform, description, tags, lyrics, vibe, or a raw `promptText`.
- All inputs sanitized by `asCleanText()` (max lengths enforced).
- Response parsed with `JSON.parse(rawText)` inside try/catch.
- Returns 502 if Gemini returns malformed JSON. Returns 500 if Gemini call fails.
- No caching, no retry, no fallback model.

### Metadata rules

- `server/metadataRules.js`: defines `MARKER_RULES` (provenance marker detection), `isBenign()` (tags safe to leave in output), `isAllowedInjected()` (tags SpectraCleanse intentionally writes).
- `detectMarkers()`: scans ExifTool tags against MARKER_RULES. Returns hits with `ruleId`, `category`, `severity`, `matchedTag`, `matchedValue`.
- `verifyFinalState()`: runs after ExifTool write; checks for unexpected descriptive tags and residual provenance markers.
- `buildMetaToWrite()`: constructs the ExifTool write map from user metadata. Writes to QuickTime, ItemList, and Keys atom families for MP4/M4A.

### QuickTime timestamp handling
- Six QuickTime timestamp fields (`CreateDate`, `ModifyDate`, `TrackCreateDate`, etc.) are zeroed to `0000:00:00 00:00:00` to remove temporal provenance markers.
- This is intentional — timestamps are a known provenance signal.

### Response headers from `/api/process`
- `X-Forensic-Removed`: count of removed tags
- `X-Forensic-Tags`: JSON array of removed tag names (capped at 50)
- `X-Forensic-Status`: e.g. `"Sanitized"`
- `X-Forensic-Report`: full report JSON
- `X-Process-Run-Id`: unique run identifier
- `X-Output-SHA256`: SHA-256 of the output file (stage: `after_timestamp_write_final`)
- `X-Download-Name`: suggested filename for download
- `X-Usage-This-Month`: jobs consumed this month
- `X-Usage-Limit`: limit (`3` for free, `"unlimited"` for paid)

---

## Format support matrix (from code — not assumed)

| Format | Quick Cleanse (browser) | Full Server Cleanse | SEO Generation | Batch |
|---|---|---|---|---|
| MP3 | ✅ (`browser-id3-writer`) | ❌ 422 | ✅ (any format) | ❌ (server cleanse required) |
| MP4 | ❌ | ✅ | ✅ | ✅ (paid) |
| M4A | ❌ | ✅ | ✅ | ✅ (paid) |
| WAV | ❌ | ❌ 422 (uploaded but rejected) | ✅ | ❌ |
| FLAC | ❌ | ❌ 422 (uploaded but rejected) | ✅ | ❌ |
| Other | ❌ | ❌ MIME-blocked by Multer (415) | ✅ (if metadata provided) | ❌ |

**To verify format support**: check `server/cleansePolicy.js` `CLEANSE_POLICY` object. This is the authoritative source. If a format is not listed there, it is not supported by Full Server Cleanse regardless of what Multer accepts.

---

## Checklist

**Format gating**
- [ ] Is the format being evaluated listed in `CLEANSE_POLICY.server.supportedExtensions`?
- [ ] Is there a corresponding MIME type in `ALLOWED_MIME` in `server.js`?
- [ ] Does `isServerSupportedFormat()` correctly identify the format by both extension AND MIME?
- [ ] Is the user-facing error message for unsupported formats accurate (currently: "Full Server Cleanse currently supports MP4 and M4A only")?

**ExifTool safety**
- [ ] Is the ExifTool operation operating on a **copy** of the uploaded file (not the original)?
- [ ] Are all ExifTool calls properly `await`ed?
- [ ] Is error handling present for `exiftoolFailureError` (500) and `unsupportedCleanseError` (422)?
- [ ] Does the processor still call `verifyFinalState()` after writing and include the result in the report?
- [ ] Are `QUICKTIME_TIMESTAMP_FIELDS` still being zeroed to `ZERO_QUICKTIME_DATE`?

**Metadata injection**
- [ ] Are all fields going through `cleanText()` before being passed to ExifTool write?
- [ ] Is `buildMetaToWrite()` the only path for writing metadata (no raw user input to ExifTool)?
- [ ] Are atom families (ItemList, QuickTime, Keys) all written for MP4/M4A?

**Gemini SEO**
- [ ] Is `GEMINI_API_KEY` validated before the API call?
- [ ] Is the structured JSON schema (`title`, `description`, `tags`) still enforced in the request?
- [ ] Is the response parsed defensively (try/catch around JSON.parse)?
- [ ] Are output fields type-checked as strings before returning to the client?
- [ ] Is `buildSeoPrompt` returning empty string for payloads with no useful fields? (Results in 400, not a Gemini call.)

**File cleanup**
- [ ] Is the input file (`req.file.path`) deleted on all paths (success, 422, 402, copy failure)?
- [ ] Is the output file deleted after `res.download()` completes?
- [ ] Are batch output files registered with `cleanup.registerForCleanup()`?
- [ ] Is `cleanup.deleteImmediately()` called after the download stream ends?

---

## Trust boundaries

| Input | Trust level | Sanitization |
|---|---|---|
| Uploaded file content | Untrusted | MIME filter (Multer), extension check (cleansePolicy), ExifTool operates on copy |
| `req.body` metadata fields | Untrusted | `asCleanText()` / `cleanText()` with max lengths |
| `req.body.promptText` | Untrusted | `asCleanText(payload.promptText, 4000)` |
| Gemini API response | Semi-trusted | `JSON.parse()` in try/catch, field type-checked before return |
| ExifTool tag output | Semi-trusted | Post-process `verifyFinalState()`, `isBenign()` / `isAllowedInjected()` checks |
| JWT `req.user` | Trusted (verified) | `jwt.verify()` with `JWT_SECRET` in `requireAuth` |

---

## Failure modes

| Failure | HTTP | Reason field | User impact |
|---|---|---|---|
| Unsupported format (MP3 to server) | 422 | `unsupported_file_type` | Clear message; user directed to Quick Cleanse |
| Unsupported MIME (Multer) | 415 | — | "Unsupported file type: [mime]" |
| Free tier limit reached | 402 | `usage_limit` | Upgrade modal triggered |
| ExifTool failure | 500 | `exiftool_failure` | Generic processing error |
| File copy failure | 500 | — | "File copy failed" |
| Gemini malformed JSON | 502 | — | "Malformed JSON returned by Gemini" |
| Gemini API failure | 500 | — | `err.message` from fetch |
| File too large | 413 | — | "File too large (max 500MB)" |
| Batch: free plan | 403 | `plan_restriction` | "Batch processing requires Creator or Studio plan" |

---

## Privacy and retention

- Uploaded files are deleted immediately after download (or on cleanup timer).
- No files are stored beyond the request/download lifecycle.
- SQLite `jobs` table stores: user_id, filename (original name), platform, created_at. No file content.
- `uploads/` is ephemeral on Render unless pointed at a persistent disk.

---

## Output format

```
## Processing flow summary
[What happens from upload to download for this format/scenario]

## Supported/unsupported formats
[Table showing current status, verified from cleansePolicy.js]

## Trust boundaries
[Where user input enters and how it is sanitized]

## Failure modes
[What can go wrong and what the user/system sees]

## Security concerns
[Any path where user input could reach ExifTool unsanitized]

## UX concerns
[Any mismatch between user-facing claims and actual code behavior]

## Test fixture plan
[Files and metadata needed to test this scenario]

## Recommended changes
[If reviewing a proposed change — what to fix or improve]
```

---

## Do not assume
- Do not assume WAV or FLAC are reliably processed — they are Multer-accepted but processor-rejected.
- Do not assume Quick Cleanse handles any format besides MP3.
- Do not assume Gemini always returns valid JSON — the response must be parsed defensively.
- Do not assume cleanup runs synchronously — output files are deleted asynchronously after the download stream.
- Do not claim any format is "supported" without verifying `cleansePolicy.js` `CLEANSE_POLICY`.
