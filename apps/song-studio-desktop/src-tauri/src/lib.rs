use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

fn ffmpeg_exe_name() -> &'static str {
    if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" }
}

/// Candidate dev FFmpeg locations (node_modules/ffmpeg-static), relative to the
/// working dir and the executable, so dev mode "just works" without env setup.
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

/// Resolution order: SONG_STUDIO_FFMPEG -> (future sidecar) -> dev
/// node_modules/ffmpeg-static -> system PATH `ffmpeg`.
fn resolve_ffmpeg() -> Resolved {
    if let Ok(p) = std::env::var("SONG_STUDIO_FFMPEG") {
        if !p.is_empty() {
            let found = Path::new(&p).exists();
            return Resolved { path: p, source: "env", found };
        }
    }
    // Sidecar (PLANNED): a bundled FFmpeg resource would be checked here.
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
    serde_json::json!({ "found": r.found, "path": r.path, "source": r.source })
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
    if !resolved.found && resolved.source == "system-path" {
        return Err("FFmpeg not found. Install FFmpeg, set SONG_STUDIO_FFMPEG, or run `npm install` so the dev binary is available.".to_string());
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
    let output = Command::new(&resolved.path)
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
    let output = Command::new(npm)
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![run_ffmpeg, run_canvas_lab, font_path, resolve_font, ffmpeg_status])
        .run(tauri::generate_context!())
        .expect("error while running Song Studio");
}
