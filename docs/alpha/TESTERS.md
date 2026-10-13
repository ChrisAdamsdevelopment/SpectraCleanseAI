# Song Studio Alpha — for test users

Song Studio helps you **direct AI-generated moving scenes around your music**. You describe
who is on screen, what happens, and how it should feel; the AI generates the scenes;
Song Studio remembers your characters, coordinates the scenes, repairs what needs fixing,
and assembles it all to your song.

This is a **private alpha**. Things will be rough. Thank you for testing it.

---

## What you need

- **Windows 10 or Windows 11, 64-bit.** (No Mac or Linux build yet.)
- About **300 MB** of free disk space.
- Optionally, an API key from **Google** and/or **xAI (Grok)** — see below. You can use
  Song Studio without one.

You do **not** need to install Node, Rust, Git, FFmpeg, or any developer tools.
Everything Song Studio needs is inside the installer.

---

## Install

1. Go to the **Releases** page you were sent and download
   **`Song-Studio-<version>-Windows-x64-Setup.exe`**.
2. Run it. It installs for **your user account only** — it does not ask for administrator rights.

### "Windows protected your PC" — this is expected

The alpha installer is **not code-signed yet**, so Windows SmartScreen shows a blue warning.
This is normal for a private alpha and does not mean anything is wrong.

To continue: click **More info** → **Run anyway**.

If you would rather not do that, use the **Portable ZIP** instead: unzip it anywhere and run
`Song Studio.exe`. Keep `ffmpeg.exe` in the same folder — that is the video engine.

> The portable build does **not** auto-update. To update it, download a newer ZIP.

---

## First launch

A short introduction appears **once**:

1. **Welcome** — what Song Studio is.
2. **Connect a provider** — Google, Grok, or **Skip for now**.
3. **Begin** — create a project, open one, or just look around.

You can **skip the whole thing** and start creating immediately. It will not come back.
If you ever want it again: **Settings → Show introduction again**.

---

## Connecting Google or Grok (optional)

Song Studio does not generate video by itself — it directs a provider that does. You bring
your own API key.

> **Song Studio never charges you and never sells credits.** You pay Google or xAI directly
> for what you generate. **Video is much more expensive than text or images** — a few seconds
> of video can cost real money. Start small and watch your provider's usage dashboard.

### Google

1. Go to **aistudio.google.com** → **Get API key**.
2. Copy the key (it usually starts with `AIza`).
3. In Song Studio: **Settings → AI Providers → Google → paste the key → Test Connection**.

Used for: scene video (Gemini Omni Flash, Veo), reference images, and the directing assistant.

### xAI / Grok

1. Go to **console.x.ai** and create an API key.
2. Copy the key (it starts with `xai-`).
3. In Song Studio: **Settings → AI Providers → xAI / Grok → paste the key → Test Connection**.

Used for: scene video (Grok Imagine, up to 15 seconds per shot), reference images, and the
directing assistant.

> **Important:** a **Grok or X Premium subscription is NOT the same as xAI API access.**
> They are billed separately. If your subscription is active but Song Studio says
> *"no API credits"*, you need to add credits at **console.x.ai** — that is an xAI account
> matter, not a Song Studio bug.

### Where your key is stored

You choose:

- **Remember securely on this computer** — the key goes into the **Windows Credential Manager**
  (the same vault Windows uses for its own saved passwords). It survives restarts. Remove it any
  time with **Forget key**.
- **Use for this session only** — the key is held in memory and is **gone when you close
  Song Studio**.

Your key is **never** written into your project file, never included in diagnostics, never
written to logs, and never sent anywhere except to Google or xAI.

### No key? You can still use Song Studio

Choose **Manual package**. Song Studio exports the exact request — prompt, reference images,
timing, everything — as a folder. Generate it with any tool you like, then import the returned
MP4 and Song Studio reconnects it to the right scene.

---

## Your first video (the short path)

1. **Add a song.**
2. *(Optional)* Add **one** picture of your artist or character. One is enough to start.
3. **Create one scene** — when it happens in the song, who's in it, what happens.
4. Choose **Auto**, **Google**, **Grok**, or **Manual**.
5. **Generate.** Song Studio checks the request against the provider first and tells you
   plainly if something won't fit.
6. **Review** the result, then **Accept** it (or ask for a repair).
7. **Assemble** — your accepted scenes are laid onto the song.

You do **not** need to upload every outfit, tattoo, ring, prop, or location before you start.
Add references later, only when a scene actually needs them.

---

## Saving, reopening, and recovery

Song Studio saves as you work. Your projects are `.songstudio.json` files you choose the location
for.

- **Save** writes to your current project file; **Save As** makes a copy at a new location.
- When you reopen Song Studio, the opening screen offers **Reopen last project**.
- If Song Studio ever closes unexpectedly, the opening screen offers **Recover unsaved work**.
  Recovering never overwrites your saved file until you choose to Save — your original is safe.

Everything you need (Settings, your version, update status, and whether the video engine is
working) is on that opening screen, before you open a project.

---

## Updates

**Settings → Check for updates.** Song Studio also checks quietly in the background at startup.

When an update is available you'll see the new version and what changed. You choose when to
download. Song Studio will **not** restart while a scene is generating or a render is running.
The introduction does **not** come back after an update.

---

## When something breaks

**Settings → Help us fix a problem.**

Song Studio builds a small diagnostics package and **shows you exactly what's in it before you
send it**. By default it contains only:

- app version, Windows version, whether the video engine was found;
- which provider you used and what the error category was;
- counts (how many scenes/characters/takes) — **not** their content;
- recent logs with secrets and folder paths removed.

It never includes your **API key, your song, your images, your video, your lyrics, your prompts,
your project title, or your folder paths** — unless you explicitly tick a box to add them.

Send the package with a short note about what you were doing.

---

## Known alpha limitations

- **Windows x64 only.** No Mac or Linux build. The download is an installer (`.exe`) or a portable ZIP — there is no MSI for alpha builds.
- **The installer is unsigned**, so SmartScreen warns on first run (see above).
- **You bring your own API key**, and provider costs are yours. Video is expensive.
- **Grok cannot repair an existing video.** xAI does not document source-video editing, so
  Song Studio will not pretend it can — repairs route to Google or to a manual package.
- **Grok clips are capped at 15 seconds**; Veo clips at 8. Song Studio blocks a longer scene
  and offers to split it rather than silently shortening your direction.
- **No provider offers true audio-driven lip-sync yet.** Lip-sync repair works, but the manual
  package is the most faithful route.
- **Exact lip-sync, and generation quality generally, depend on the provider** — not on
  Song Studio.
- **The portable ZIP does not auto-update.**
- Generated media is stored on your computer only. Nothing is uploaded anywhere except to the
  provider you connected.
