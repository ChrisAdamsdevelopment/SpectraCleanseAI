use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

/// Windows CREATE_NO_WINDOW flag (ALPHA-002 §13): keep bundled FFmpeg/ffprobe
/// child processes from flashing a console window in the GUI-subsystem app.
/// stdout/stderr/exit-code capture is unaffected. No-op on non-Windows.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn quiet_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn ffmpeg_exe_name() -> &'static str {
    if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" }
}

/// The sidecar file name Tauri bundles from `bundle.externalBin` (ALPHA-001 §1).
/// Tauri requires the source file to carry a `-$TARGET_TRIPLE` suffix; the
/// bundled copy sits beside the app executable. We probe BOTH the stripped name
/// and the triple-suffixed name so resolution is correct regardless of which
/// convention the bundler used on this platform/version.
fn sidecar_candidates() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
    let names: [String; 3] = [
        ffmpeg_exe_name().to_string(),
        format!("ffmpeg-{}{}", current_target_triple(), if cfg!(windows) { ".exe" } else { "" }),
        format!("binaries/ffmpeg-{}{}", current_target_triple(), if cfg!(windows) { ".exe" } else { "" }),
    ];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            for n in &names {
                v.push(dir.join(n));
            }
            // NSIS/MSI place resources under a `resources` subfolder.
            for n in &names {
                v.push(dir.join("resources").join(n));
            }
        }
    }
    v
}

/// The compile-time target triple, used to find the triple-suffixed sidecar.
fn current_target_triple() -> &'static str {
    // These are the alpha-supported desktop targets.
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) { "x86_64-pc-windows-msvc" }
    else if cfg!(all(target_os = "macos", target_arch = "aarch64")) { "aarch64-apple-darwin" }
    else if cfg!(all(target_os = "macos", target_arch = "x86_64")) { "x86_64-apple-darwin" }
    else if cfg!(all(target_os = "linux", target_arch = "x86_64")) { "x86_64-unknown-linux-gnu" }
    else { "unknown" }
}

/// Candidate dev FFmpeg locations (node_modules/ffmpeg-static), relative to the
/// working dir and the executable, so dev mode "just works" without env setup.
/// These are DEV-ONLY and are never consulted in an installed build (§1).
fn dev_ffmpeg_candidates() -> Vec<PathBuf> {
    let name = ffmpeg_exe_name();
    let mut v: Vec<PathBuf> = Vec::new();
    for base in ["node_modules/ffmpeg-static", "../node_modules/ffmpeg-static"] {
        v.push(PathBuf::from(base).join(name));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            v.push(dir.join("../../../node_modules/ffmpeg-static").join(name));
            v.push(dir.join("../../node_modules/ffmpeg-static").join(name));
        }
    }
    v
}

fn on_path(name: &str) -> bool {
    let exe = if cfg!(windows) { format!("{name}.exe") } else { name.to_string() };
    if let Ok(paths) = std::env::var("PATH") {
        for dir in std::env::split_paths(&paths) {
            if dir.join(&exe).exists() {
                return true;
            }
        }
    }
    false
}

struct Resolved {
    path: String,
    source: &'static str,
    found: bool,
}

/// True for a real installed build (release profile). Debug builds are dev.
fn is_installed_build() -> bool {
    !cfg!(debug_assertions)
}

/// FFmpeg resolution (ALPHA-001 §1).
///
/// INSTALLED BUILD:  bundled sidecar ONLY. We deliberately do NOT fall back to a
/// developer machine's node_modules or a system PATH ffmpeg — a shipped app must
/// use the binary it shipped with, and a missing sidecar must be reported as a
/// packaging fault rather than silently papered over by whatever is on PATH.
///
/// DEV BUILD:  SONG_STUDIO_FFMPEG -> sidecar -> node_modules/ffmpeg-static ->
/// system PATH, so `tauri dev` works with no setup.
fn resolve_ffmpeg() -> Resolved {
    if !is_installed_build() {
        if let Ok(p) = std::env::var("SONG_STUDIO_FFMPEG") {
            if !p.is_empty() {
                let found = Path::new(&p).exists();
                return Resolved { path: p, source: "env", found };
            }
        }
    }
    for cand in sidecar_candidates() {
        if cand.exists() {
            return Resolved { path: cand.to_string_lossy().to_string(), source: "bundled-sidecar", found: true };
        }
    }
    if is_installed_build() {
        // Honest failure: no silent developer-machine fallback in a shipped app.
        return Resolved { path: String::new(), source: "bundled-sidecar", found: false };
    }
    for cand in dev_ffmpeg_candidates() {
        if cand.exists() {
            return Resolved { path: cand.to_string_lossy().to_string(), source: "dev-node-modules", found: true };
        }
    }
    Resolved { path: "ffmpeg".to_string(), source: "system-path", found: on_path("ffmpeg") }
}

#[tauri::command]
fn ffmpeg_status() -> serde_json::Value {
    let r = resolve_ffmpeg();
    serde_json::json!({ "found": r.found, "path": r.path, "source": r.source, "installedBuild": is_installed_build() })
}

// ── Secure API-key storage via the OS credential store (ALPHA-001 §7) ────────
// Windows Credential Manager (and the platform equivalent elsewhere) through the
// `keyring` crate. Secrets never pass through settings.json or ReleaseProject.
// Every error is returned as a short category string — never the secret.

const KEYRING_SERVICE: &str = "com.spectracleanse.songstudio";

#[tauri::command]
fn secure_available() -> bool {
    // A store is usable if we can construct an entry and perform a read attempt
    // without the backend erroring structurally (NoEntry is a success signal).
    match keyring::Entry::new(KEYRING_SERVICE, "__probe__") {
        Ok(entry) => match entry.get_password() {
            Ok(_) => true,
            Err(keyring::Error::NoEntry) => true,
            Err(_) => false,
        },
        Err(_) => false,
    }
}

#[tauri::command]
fn secure_set(provider_id: String, secret: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider_id).map_err(|_| "credential-store-unavailable".to_string())?;
    entry.set_password(&secret).map_err(|_| "credential-store-write-failed".to_string())
}

#[tauri::command]
fn secure_get(provider_id: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider_id).map_err(|_| "credential-store-unavailable".to_string())?;
    match entry.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("credential-store-read-failed".to_string()),
    }
}

#[tauri::command]
fn secure_remove(provider_id: String) -> Result<(), String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, &provider_id).map_err(|_| "credential-store-unavailable".to_string())?;
    match entry.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone == success
        Err(_) => Err("credential-store-delete-failed".to_string()),
    }
}

// ── Startup health checks (ALPHA-001 §1) ────────────────────────────────────
// Reported to the UI, which renders plain-language recovery text. Never throws.

#[tauri::command]
fn health_check(app: tauri::AppHandle) -> serde_json::Value {
    use tauri::Manager;
    let ffmpeg = resolve_ffmpeg();

    let app_data = app.path().app_data_dir().ok();
    let app_data_ok = match &app_data {
        Some(d) => std::fs::create_dir_all(d).is_ok(),
        None => false,
    };
    let app_data_str = app_data.map(|d| d.to_string_lossy().to_string()).unwrap_or_default();

    // Probe writability with a real temp file rather than assuming.
    let app_data_writable = if app_data_ok && !app_data_str.is_empty() {
        let probe = Path::new(&app_data_str).join(".write-probe");
        let ok = std::fs::write(&probe, b"ok").is_ok();
        let _ = std::fs::remove_file(&probe);
        ok
    } else { false };

    serde_json::json!({
        "appVersion": app.package_info().version.to_string(),
        "installedBuild": is_installed_build(),
        "targetTriple": current_target_triple(),
        "appDataDir": app_data_str,
        "appDataOk": app_data_ok && app_data_writable,
        "ffmpeg": { "found": ffmpeg.found, "source": ffmpeg.source, "path": ffmpeg.path },
        "secureStore": secure_available(),
        // WebView is implicitly available — this code is running inside it.
        "webview": true,
    })
}

/// Return the first existing path from a candidate list (for font-family selection).
#[tauri::command]
fn resolve_font(candidates: Vec<String>) -> Option<String> {
    candidates.into_iter().find(|p| Path::new(p).exists())
}

/// Resolve a usable .ttf for the FFmpeg title overlay; None => overlay skipped.
#[tauri::command]
fn font_path() -> Option<String> {
    let candidates = [
        "C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/arial.ttf", "C:/Windows/Fonts/segoeui.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf", "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ];
    candidates.iter().find(|p| Path::new(p).exists()).map(|p| p.to_string())
}

/// Pick a non-colliding output path so repeated renders never overwrite.
fn ensure_unique(path: &str) -> String {
    if !Path::new(path).exists() {
        return path.to_string();
    }
    let p = Path::new(path);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("out");
    let ext = p.extension().and_then(|s| s.to_str()).unwrap_or("mp4");
    let parent = p.parent().map(|x| x.to_path_buf()).unwrap_or_default();
    for i in 2..1000 {
        let cand = parent.join(format!("{stem}_{i}.{ext}"));
        if !cand.exists() {
            return cand.to_string_lossy().to_string();
        }
    }
    path.to_string()
}

/// Thin executor: runs FFmpeg with args produced by the shared TypeScript render
/// core. All render logic lives in TS; Rust resolves FFmpeg, dedupes the output
/// path, runs the binary, and reports the result.
#[tauri::command]
async fn run_ffmpeg(app: tauri::AppHandle, args: Vec<String>) -> Result<serde_json::Value, String> {
    let resolved = resolve_ffmpeg();
    let _ = app.emit("render://log", format!("[ffmpeg] using {} ({})", resolved.path, resolved.source));
    if !resolved.found {
        // Plain-language, honest failure. An installed build never silently
        // borrows a developer-machine or system FFmpeg (§1).
        return Err(if is_installed_build() {
            "Song Studio could not find its bundled video engine. This installation looks incomplete — please reinstall Song Studio from the original download. (Export a diagnostics package from Settings if this keeps happening.)".to_string()
        } else {
            "FFmpeg not found. Run `npm install` in apps/song-studio-desktop so the dev binary is available, or set SONG_STUDIO_FFMPEG.".to_string()
        });
    }

    let mut args = args;
    if let Some(last) = args.last_mut() {
        let unique = ensure_unique(last);
        if unique != *last {
            let _ = app.emit("render://log", format!("[ffmpeg] output exists; writing {} instead", unique));
        }
        *last = unique;
    }
    let out_path = args.last().cloned().unwrap_or_default();

    let _ = app.emit("render://log", format!("[ffmpeg] rendering ({} args)…", args.len()));
    let output = quiet_command(&resolved.path)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to start ffmpeg '{}': {}", resolved.path, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: Vec<&str> = stderr.lines().rev().take(20).collect::<Vec<_>>().into_iter().rev().collect();
        let joined = tail.join("\n");
        let _ = app.emit("render://log", joined.clone());
        return Err(format!("FFmpeg exited with {}: {}", output.status, joined));
    }

    let bytes = std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
    let _ = app.emit("render://log", format!("[ffmpeg] ok -> {} ({} bytes)", out_path, bytes));
    Ok(serde_json::json!({ "outputPath": out_path, "bytes": bytes }))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CanvasLabOptions {
    input_path: String,
    output_dir: String,
    anchor_time_sec: Option<f64>,
    min_duration_sec: Option<f64>,
    max_duration_sec: Option<f64>,
    top_n: Option<u32>,
    min_similarity_score: Option<f64>,
    method: Option<String>,
    compare_methods: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CanvasLabRunResult {
    ok: bool,
    error: Option<String>,
    report: Option<serde_json::Value>,
    report_path: Option<String>,
    output_path: Option<String>,
    workspace_path: Option<String>,
    stdout: String,
    stderr: String,
}

fn app_dir() -> Result<PathBuf, String> {
    let cwd = std::env::current_dir().map_err(|e| format!("Could not read current dir: {e}"))?;
    if cwd.join("package.json").exists() && cwd.join("src/canvas/canvas-lab.mts").exists() {
        return Ok(cwd);
    }
    let nested = cwd.join("apps/song-studio-desktop");
    if nested.join("package.json").exists() && nested.join("src/canvas/canvas-lab.mts").exists() {
        return Ok(nested);
    }
    Err("Could not locate apps/song-studio-desktop from the current process. Run this in dev mode with `npm run tauri dev`.".to_string())
}

fn push_optional_arg<T: ToString>(args: &mut Vec<String>, name: &str, value: Option<T>) {
    if let Some(value) = value {
        args.push(format!("--{name}={}", value.to_string()));
    }
}

fn parse_canvas_stdout(stdout: &str) -> Option<serde_json::Value> {
    for (idx, ch) in stdout.char_indices() {
        if ch == '{' {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&stdout[idx..]) {
                return Some(value);
            }
        }
    }
    None
}

#[tauri::command]
async fn run_canvas_lab(options: CanvasLabOptions) -> Result<CanvasLabRunResult, String> {
    if options.input_path.trim().is_empty() || options.output_dir.trim().is_empty() {
        return Err("Canvas Test Drive requires both an input video and output directory.".to_string());
    }

    let mut args = vec!["run".to_string(), "canvas:lab".to_string(), "--".to_string(), "--ffmpeg".to_string()];
    args.push(format!("--input={}", options.input_path));
    args.push(format!("--output-dir={}", options.output_dir));
    push_optional_arg(&mut args, "anchor", options.anchor_time_sec);
    push_optional_arg(&mut args, "min-duration", options.min_duration_sec);
    push_optional_arg(&mut args, "max-duration", options.max_duration_sec);
    push_optional_arg(&mut args, "top-n", options.top_n);
    push_optional_arg(&mut args, "min-similarity", options.min_similarity_score);
    if let Some(method) = options.method.filter(|m| !m.is_empty()) {
        args.push(format!("--method={method}"));
    }
    if options.compare_methods.unwrap_or(false) {
        args.push("--compare-methods".to_string());
    }

    let app_dir = app_dir()?;
    let npm = if cfg!(windows) { "npm.cmd" } else { "npm" };
    let output = quiet_command(npm)
        .current_dir(app_dir)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to start Canvas lab through npm: {e}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    let parsed = parse_canvas_stdout(&stdout);
    let report_path = parsed.as_ref().and_then(|v| v.get("reportPath")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let workspace_path = parsed.as_ref().and_then(|v| v.get("workspacePath")).and_then(|v| v.as_str()).map(|s| s.to_string());
    let output_path = parsed.as_ref()
        .and_then(|v| v.get("export"))
        .and_then(|v| v.get("outputPath"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let error = if output.status.success() { None } else { Some(format!("Canvas lab exited with {}", output.status)) };
    Ok(CanvasLabRunResult { ok: output.status.success(), error, report: parsed, report_path, output_path, workspace_path, stdout, stderr })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    // ALPHA-001 §3: in-app updates on desktop targets only.
    #[cfg(any(target_os = "windows", target_os = "macos", target_os = "linux"))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .invoke_handler(tauri::generate_handler![
            run_ffmpeg, run_canvas_lab, font_path, resolve_font, ffmpeg_status,
            health_check, secure_available, secure_set, secure_get, secure_remove
        ])
        .run(tauri::generate_context!())
        .expect("error while running Song Studio");
}
