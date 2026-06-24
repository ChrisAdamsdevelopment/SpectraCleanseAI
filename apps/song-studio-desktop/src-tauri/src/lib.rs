use std::process::Command;
use tauri::Emitter;

/// Resolve a usable .ttf for the FFmpeg title overlay across common OS locations.
/// Returns None if none is found (the overlay is then skipped).
#[tauri::command]
fn font_path() -> Option<String> {
    let candidates = [
        "C:/Windows/Fonts/arialbd.ttf",
        "C:/Windows/Fonts/arial.ttf",
        "C:/Windows/Fonts/segoeui.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/Library/Fonts/Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ];
    candidates
        .iter()
        .find(|p| std::path::Path::new(p).exists())
        .map(|p| p.to_string())
}

/// Thin executor: runs FFmpeg with the args produced by the shared TypeScript
/// render core. All render logic lives in TS; Rust only runs the binary.
///
/// FFmpeg resolution order: the `SONG_STUDIO_FFMPEG` env var, otherwise `ffmpeg`
/// on PATH. Production packaging should bundle FFmpeg as a sidecar (see README).
#[tauri::command]
async fn run_ffmpeg(app: tauri::AppHandle, args: Vec<String>) -> Result<serde_json::Value, String> {
    let ffmpeg = std::env::var("SONG_STUDIO_FFMPEG").unwrap_or_else(|_| "ffmpeg".to_string());
    let _ = app.emit("render://log", format!("[ffmpeg] {} ({} args)", ffmpeg, args.len()));

    let output = Command::new(&ffmpeg)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to start ffmpeg '{}': {}. Install FFmpeg or set SONG_STUDIO_FFMPEG.", ffmpeg, e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let tail: Vec<&str> = stderr.lines().rev().take(20).collect::<Vec<_>>().into_iter().rev().collect();
        let joined = tail.join("\n");
        let _ = app.emit("render://log", joined.clone());
        return Err(format!("FFmpeg exited with {}: {}", output.status, joined));
    }

    let out_path = args.last().cloned().unwrap_or_default();
    let bytes = std::fs::metadata(&out_path).map(|m| m.len()).unwrap_or(0);
    let _ = app.emit("render://log", format!("[ffmpeg] ok -> {} ({} bytes)", out_path, bytes));

    Ok(serde_json::json!({ "outputPath": out_path, "bytes": bytes }))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![run_ffmpeg, font_path])
        .run(tauri::generate_context!())
        .expect("error while running Song Studio");
}
