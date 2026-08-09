use base64::Engine;
use std::io::Read;
use std::os::unix::net::UnixListener;
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, State,
};

const SOCKET_PATH: &str = "/tmp/weaver.sock";
const ENV_LLM_ENDPOINT: &str = "WEAVER_LLM_ENDPOINT";
const ENV_LLM_MODEL: &str = "WEAVER_LLM_MODEL";
const ENV_LLM_API_KEY: &str = "WEAVER_LLM_API_KEY";
const ENV_LLM_SYSTEM_PROMPT: &str = "WEAVER_LLM_SYSTEM_PROMPT";

/// Stores the previously focused window address (Hyprland) or X11 window ID,
/// captured just before the quick-tray window is shown.
struct PrevWindow(Mutex<Option<String>>);

// ── Window/display helpers ────────────────────────────────────────────────────

/// Return the active window identifier for the current display server.
/// Returns `None` on generic Wayland (no hyprctl) or on error.
fn capture_active_window() -> Option<String> {
    if std::env::var("HYPRLAND_INSTANCE_SIGNATURE").is_ok() {
        let out = std::process::Command::new("hyprctl")
            .args(["activewindow", "-j"])
            .output()
            .ok()?;
        let json: serde_json::Value = serde_json::from_slice(&out.stdout).ok()?;
        return json["address"].as_str().map(|s| s.to_string());
    }
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        return None; // Generic Wayland — no universal focus query
    }
    // X11 fallback via xdotool
    let out = std::process::Command::new("xdotool")
        .arg("getactivewindow")
        .output()
        .ok()?;
    let id = String::from_utf8(out.stdout).ok()?.trim().to_string();
    if id.is_empty() { None } else { Some(id) }
}

/// Re-focus the window that was active before Weaver opened.
fn focus_previous_window(prev: &str) {
    if std::env::var("HYPRLAND_INSTANCE_SIGNATURE").is_ok() {
        let _ = std::process::Command::new("hyprctl")
            .args(["dispatch", "focuswindow", &format!("address:{prev}")])
            .status();
    } else if std::env::var("WAYLAND_DISPLAY").is_err() {
        // X11 only
        let _ = std::process::Command::new("xdotool")
            .args(["windowfocus", "--sync", prev])
            .status();
    }
}

/// Simulate Ctrl+V (or Cmd+V on macOS) in the currently focused window.
fn send_paste_key() {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("powershell")
            .args(["-Command", "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^v')"])
            .status();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("osascript")
            .args(["-e", "tell application \"System Events\" to keystroke \"v\" using command down"])
            .status();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if std::env::var("WAYLAND_DISPLAY").is_ok() {
            let _ = std::process::Command::new("wtype")
                .args(["-M", "ctrl", "-P", "v", "-p", "v", "-m", "ctrl"])
                .status();
        } else {
            let _ = std::process::Command::new("xdotool")
                .args(["key", "--clearmodifiers", "ctrl+v"])
                .status();
        }
    }
}

/// Simulate Ctrl+C (or Cmd+C on macOS) in the currently focused window before analysis.
fn send_copy_key() {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("powershell")
            .args(["-Command", "$wshell = New-Object -ComObject wscript.shell; $wshell.SendKeys('^c')"])
            .status();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("osascript")
            .args(["-e", "tell application \"System Events\" to keystroke \"c\" using command down"])
            .status();
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        if std::env::var("WAYLAND_DISPLAY").is_ok() {
            let _ = std::process::Command::new("wtype")
                .args(["-M", "ctrl", "-P", "c", "-p", "c", "-m", "ctrl"])
                .status();
        } else {
            let _ = std::process::Command::new("xdotool")
                .args(["key", "--clearmodifiers", "ctrl+c"])
                .status();
        }
    }
}

/// Read current clipboard text using arboard with OS fallbacks.
fn read_clipboard_text() -> Option<String> {
    if let Ok(mut board) = arboard::Clipboard::new() {
        if let Ok(text) = board.get_text() {
            let trimmed = text.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        let out = std::process::Command::new("wl-paste")
            .arg("--no-newline")
            .output()
            .ok()?;
        if out.status.success() {
            let text = String::from_utf8(out.stdout).ok()?;
            if text.is_empty() { None } else { Some(text) }
        } else {
            None
        }
    } else {
        let out = std::process::Command::new("xclip")
            .args(["-selection", "clipboard", "-o"])
            .output()
            .ok()?;
        let text = String::from_utf8(out.stdout).ok()?;
        if text.is_empty() { None } else { Some(text) }
    }
}

/// Read the primary selection (highlighted text) without touching the clipboard.
/// On Wayland uses `wl-paste --primary`; on X11 uses `xclip -selection primary`.
/// This is used for append/prepend so the selected text never enters clipboard history
/// as a standalone entry.
fn read_primary_selection() -> Option<String> {
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        let out = std::process::Command::new("wl-paste")
            .args(["--primary", "--no-newline"])
            .output()
            .ok()?;
        if out.status.success() {
            let text = String::from_utf8(out.stdout).ok()?;
            if text.is_empty() { None } else { Some(text) }
        } else {
            None
        }
    } else {
        let out = std::process::Command::new("xclip")
            .args(["-selection", "primary", "-o"])
            .output()
            .ok()?;
        let text = String::from_utf8(out.stdout).ok()?;
        if text.is_empty() { None } else { Some(text) }
    }
}

/// Write text to the system clipboard using arboard with OS fallbacks.
fn write_clipboard(text: &str) -> Result<(), String> {
    if let Ok(mut board) = arboard::Clipboard::new() {
        if board.set_text(text.to_string()).is_ok() {
            return Ok(());
        }
    }
    use std::io::Write;
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        let mut child = std::process::Command::new("wl-copy")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("wl-copy: {e}"))?;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        }
        child.wait().map_err(|e| e.to_string())?;
    } else {
        let mut child = std::process::Command::new("xclip")
            .args(["-selection", "clipboard"])
            .stdin(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("xclip: {e}"))?;
        if let Some(stdin) = child.stdin.as_mut() {
            stdin.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        }
        child.wait().map_err(|e| e.to_string())?;
    }
    Ok(())
}

struct ClipboardImage {
    bytes: Vec<u8>,
    mime_type: String,
}

fn url_decode(s: &str) -> String {
    let mut result = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(hex_str) = std::str::from_utf8(&bytes[i + 1..i + 3]) {
                if let Ok(byte_val) = u8::from_str_radix(hex_str, 16) {
                    result.push(byte_val as char);
                    i += 3;
                    continue;
                }
            }
        }
        result.push(bytes[i] as char);
        i += 1;
    }
    result
}

fn try_read_image_file_path(text: &str) -> Option<ClipboardImage> {
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line == "copy" || line == "cut" {
            continue;
        }

        let path_str = if let Some(stripped) = line.strip_prefix("file://") {
            url_decode(stripped)
        } else {
            url_decode(line)
        };

        let path = std::path::Path::new(&path_str);
        if path.is_file() {
            let ext = path.extension()?.to_str()?.to_lowercase();
            let mime_type = match ext.as_str() {
                "png" => "image/png",
                "jpg" | "jpeg" => "image/jpeg",
                "webp" => "image/webp",
                "bmp" => "image/bmp",
                _ => continue,
            };
            if let Ok(bytes) = std::fs::read(path) {
                if !bytes.is_empty() {
                    return Some(ClipboardImage {
                        bytes,
                        mime_type: mime_type.to_string(),
                    });
                }
            }
        }
    }
    None
}

fn read_clipboard_image() -> Option<ClipboardImage> {
    // 1. Check URI / File list from File Managers (text/uri-list, x-special/gnome-copied-files)
    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        for mime in &["text/uri-list", "x-special/gnome-copied-files", "text/plain"] {
            if let Ok(out) = std::process::Command::new("wl-paste").args(["--no-newline", "--type", mime]).output() {
                if out.status.success() {
                    let text = String::from_utf8_lossy(&out.stdout);
                    if let Some(img) = try_read_image_file_path(&text) {
                        return Some(img);
                    }
                }
            }
            if let Ok(out) = std::process::Command::new("wl-paste").args(["--primary", "--no-newline", "--type", mime]).output() {
                if out.status.success() {
                    let text = String::from_utf8_lossy(&out.stdout);
                    if let Some(img) = try_read_image_file_path(&text) {
                        return Some(img);
                    }
                }
            }
        }
    } else {
        for mime in &["text/uri-list", "x-special/gnome-copied-files", "STRING"] {
            if let Ok(out) = std::process::Command::new("xclip").args(["-selection", "clipboard", "-t", mime, "-o"]).output() {
                if out.status.success() {
                    let text = String::from_utf8_lossy(&out.stdout);
                    if let Some(img) = try_read_image_file_path(&text) {
                        return Some(img);
                    }
                }
            }
            if let Ok(out) = std::process::Command::new("xclip").args(["-selection", "primary", "-t", mime, "-o"]).output() {
                if out.status.success() {
                    let text = String::from_utf8_lossy(&out.stdout);
                    if let Some(img) = try_read_image_file_path(&text) {
                        return Some(img);
                    }
                }
            }
        }
    }

    // 2. Check standard text in clipboard or primary selection for image file paths
    if let Some(text) = read_clipboard_text().or_else(read_primary_selection) {
        if let Some(img) = try_read_image_file_path(&text) {
            return Some(img);
        }
    }

    // 3. Check raw image pixel bytes from clipboard / primary selection (e.g. image/png, image/jpeg, etc.)
    let supported_image_types = [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
        "image/bmp",
        "image/x-png",
    ];

    if std::env::var("WAYLAND_DISPLAY").is_ok() {
        if let Ok(types_out) = std::process::Command::new("wl-paste").arg("--list-types").output() {
            let types_str = String::from_utf8_lossy(&types_out.stdout);
            for mime in &supported_image_types {
                if types_str.contains(mime) {
                    if let Ok(out) = std::process::Command::new("wl-paste").args(["--no-newline", "--type", mime]).output() {
                        if out.status.success() && !out.stdout.is_empty() {
                            return Some(ClipboardImage {
                                bytes: out.stdout,
                                mime_type: mime.to_string(),
                            });
                        }
                    }
                }
            }
        }

        if let Ok(types_out) = std::process::Command::new("wl-paste").args(["--primary", "--list-types"]).output() {
            let types_str = String::from_utf8_lossy(&types_out.stdout);
            for mime in &supported_image_types {
                if types_str.contains(mime) {
                    if let Ok(out) = std::process::Command::new("wl-paste").args(["--primary", "--no-newline", "--type", mime]).output() {
                        if out.status.success() && !out.stdout.is_empty() {
                            return Some(ClipboardImage {
                                bytes: out.stdout,
                                mime_type: mime.to_string(),
                            });
                        }
                    }
                }
            }
        }
    } else {
        if let Ok(targets_out) = std::process::Command::new("xclip").args(["-selection", "clipboard", "-t", "TARGETS", "-o"]).output() {
            let targets_str = String::from_utf8_lossy(&targets_out.stdout);
            for mime in &supported_image_types {
                if targets_str.contains(mime) {
                    if let Ok(out) = std::process::Command::new("xclip").args(["-selection", "clipboard", "-t", mime, "-o"]).output() {
                        if out.status.success() && !out.stdout.is_empty() {
                            return Some(ClipboardImage {
                                bytes: out.stdout,
                                mime_type: mime.to_string(),
                            });
                        }
                    }
                }
            }
        }

        if let Ok(targets_out) = std::process::Command::new("xclip").args(["-selection", "primary", "-t", "TARGETS", "-o"]).output() {
            let targets_str = String::from_utf8_lossy(&targets_out.stdout);
            for mime in &supported_image_types {
                if targets_str.contains(mime) {
                    if let Ok(out) = std::process::Command::new("xclip").args(["-selection", "primary", "-t", mime, "-o"]).output() {
                        if out.status.success() && !out.stdout.is_empty() {
                            return Some(ClipboardImage {
                                bytes: out.stdout,
                                mime_type: mime.to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    None
}

fn extract_llm_text(response: &serde_json::Value) -> Option<String> {
    if let Some(text) = response
        .get("choices")?
        .get(0)?
        .get("message")?
        .get("content")?
        .as_str()
    {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Some(parts) = response
        .get("choices")?
        .get(0)?
        .get("message")?
        .get("content")?
        .as_array()
    {
        let mut merged = String::new();
        for part in parts {
            if let Some(text) = part.get("text").and_then(|v| v.as_str()) {
                if !merged.is_empty() {
                    merged.push('\n');
                }
                merged.push_str(text.trim());
            }
        }
        let trimmed = merged.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Some(text) = response.get("text").and_then(|v| v.as_str()) {
        let trimmed = text.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    None
}

fn env_trimmed(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

#[derive(serde::Serialize)]
struct LlmEnvConfig {
    endpoint: String,
    model: String,
    api_key: String,
    system_prompt: String,
}

fn get_llm_env_config_internal() -> LlmEnvConfig {
    LlmEnvConfig {
        endpoint: env_trimmed(ENV_LLM_ENDPOINT)
            .unwrap_or_else(|| "http://localhost:11434/v1/chat/completions".to_string()),
        model: env_trimmed(ENV_LLM_MODEL).unwrap_or_else(|| "qwen2.5vl:7b".to_string()),
        api_key: env_trimmed(ENV_LLM_API_KEY).unwrap_or_default(),
        system_prompt: env_trimmed(ENV_LLM_SYSTEM_PROMPT).unwrap_or_else(|| {
            "Perform OCR on this image. Transcribe all text, code, and symbols line by line exactly as shown. Do not skip any lines, summarize, or add commentary. Return raw text only.".to_string()
        }),
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Atomically write text to the clipboard, hide the quick-tray window,
/// restore focus to the previously active window, and send Ctrl+V.
///
/// Called from JS with the chosen text — the JS side is fire-and-forget;
/// no async chain is needed.
#[tauri::command]
async fn confirm_paste(
    text: String,
    app: tauri::AppHandle,
    prev_window: State<'_, PrevWindow>,
) -> Result<(), String> {
    let prev_id = prev_window.0.lock().unwrap().clone();

    write_clipboard(&text)?;

    if let Some(win) = app.get_webview_window("quicktray") {
        let _ = win.hide();
    }

    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_millis(150));
        if let Some(wid) = &prev_id {
            focus_previous_window(wid);
            std::thread::sleep(std::time::Duration::from_millis(150));
        }
        send_paste_key();
    })
    .await
    .map_err(|e| e.to_string())
}

/// Hide the quick-tray window without pasting (triggered by Escape or
/// clicking outside the panel).
#[tauri::command]
async fn dismiss_quicktray(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("quicktray") {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
async fn hide_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.hide();
    }
    Ok(())
}

#[tauri::command]
async fn analyze_clipboard_image(
    endpoint: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
    system_prompt: Option<String>,
) -> Result<String, String> {
    let env_cfg = get_llm_env_config_internal();

    let endpoint = endpoint
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or(env_cfg.endpoint);
    let api_key = api_key
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .or_else(|| if env_cfg.api_key.is_empty() { None } else { Some(env_cfg.api_key) });
    let model = model
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or(env_cfg.model);
    let prompt = system_prompt
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .unwrap_or(env_cfg.system_prompt);

    let prev_text = read_clipboard_text();
    let mut image_data = read_clipboard_image();
    if image_data.is_none() {
        send_copy_key();
        std::thread::sleep(std::time::Duration::from_millis(150));
        image_data = read_clipboard_image();
    }

    // Restore previous clipboard text so intermediate file paths are not left in system clipboard
    if let Some(prev) = &prev_text {
        let _ = write_clipboard(prev);
    }

    let image_data = image_data.ok_or_else(|| {
        "No image file detected under cursor. Click or select an image file and press Ctrl+Alt+C.".to_string()
    })?;
    let image_base64 = base64::engine::general_purpose::STANDARD.encode(&image_data.bytes);
    let mime_type = image_data.mime_type;

    let payload = serde_json::json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": prompt
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Transcribe every line of text and code in this image accurately from top to bottom."
                    },
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": format!("data:{mime_type};base64,{image_base64}")
                        }
                    }
                ]
            }
        ],
        "temperature": 0.1,
        "max_tokens": 2048
    });

    let client = reqwest::Client::new();
    let mut req = client
        .post(endpoint)
        .header("Content-Type", "application/json");

    if let Some(key) = api_key {
        if !key.trim().is_empty() {
            req = req.bearer_auth(key.trim());
        }
    }

    let response = req
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Request failed: {e}"))?;

    let status = response.status();

    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Invalid JSON response: {e}"))?;

    if !status.is_success() {
        return Err(format!("LLM endpoint returned {}: {body}", status.as_u16()));
    }

    let text_output = extract_llm_text(&body).ok_or_else(|| "LLM response did not contain text output".to_string())?;

    Ok(text_output)
}

#[tauri::command]
fn get_llm_env_config() -> LlmEnvConfig {
    get_llm_env_config_internal()
}

// ── Internal app logic ────────────────────────────────────────────────────────

/// Capture the active window, then show and focus the quick-tray window.
fn show_weaver(app: &tauri::AppHandle) {
    if let Ok(mut lock) = app.state::<PrevWindow>().0.lock() {
        *lock = capture_active_window();
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Some(window) = app.get_webview_window("quicktray") {
            let _ = window.show();
            let _ = window.set_focus();
        }
    });
}

/// Toggle the main Weaver window (show if hidden, hide if visible).
fn toggle_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let visible = window.is_visible().unwrap_or(false);
        if visible {
            let _ = window.hide();
        } else {
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

/// Start a Unix domain socket IPC server so external processes (e.g. Hyprland
/// keybinds triggered via `hyprctl keyword bind`) can open the quick-tray even
/// on Wayland where in-process global shortcuts do not fire across windows.
fn start_ipc_server(app_handle: tauri::AppHandle) {
    let _ = std::fs::remove_file(SOCKET_PATH); // Remove stale socket
    let listener = match UnixListener::bind(SOCKET_PATH) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[ipc] failed to bind {SOCKET_PATH}: {e}");
            return;
        }
    };
    eprintln!("[ipc] listening on {SOCKET_PATH}");

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(mut s) => {
                    let mut buf = [0u8; 256];
                    if let Ok(n) = s.read(&mut buf) {
                        let msg = String::from_utf8_lossy(&buf[..n]);
                        match msg.trim() {
                            "quick-tray" => {
                                show_weaver(&app_handle);
                            },
                            "toggle" => {
                                toggle_window(&app_handle);
                            },
                            "analyze-image" => {
                                send_copy_key();
                                std::thread::sleep(std::time::Duration::from_millis(100));
                                show_weaver(&app_handle);
                                std::thread::sleep(std::time::Duration::from_millis(50));
                                let _ = app_handle.emit("analyze-image-shortcut", serde_json::json!({}));
                            }
                            cmd @ ("append-clip" | "prepend-clip") => {
                                // base  = current clipboard (text A, already in history)
                                // selected = highlighted text (text B/C, never copied,
                                //            never enters history as a standalone entry)
                                if let (Some(base), Some(selected)) =
                                    (read_clipboard_text(), read_primary_selection())
                                {
                                    let merged = if cmd == "append-clip" {
                                        format!("{base}\n{selected}")
                                    } else {
                                        format!("{selected}\n{base}")
                                    };
                                    if write_clipboard(&merged).is_ok() {
                                        let _ = app_handle.emit(
                                            "merge-clipboard",
                                            serde_json::json!({ "base": base, "merged": merged }),
                                        );
                                    }
                                }
                            }
                            other => eprintln!("[ipc] unknown command: {other}"),
                        }
                    }
                }
                Err(e) => eprintln!("[ipc] accept error: {e}"),
            }
        }
    });
}

/// Register Hyprland compositor-level keybinds via `hyprctl keyword bind`.
/// These are runtime dispatches — they do not persist across compositor
/// restarts, but Weaver re-registers them on each launch.
///
/// Registered binds:
///   Ctrl+Alt+W     → open quick-tray picker
///   Ctrl+Alt+Down  → append highlighted (primary selection) text after clipboard
///   Ctrl+Alt+Up    → prepend highlighted (primary selection) text before clipboard
///
/// Workflow: copy text A with Ctrl+C, then SELECT (highlight) text B without
/// copying, then press Ctrl+Alt+Down → clipboard becomes "A\nB". B is never
/// stored in clipboard history as a standalone entry.
fn register_hyprland_keybind() {
    if std::env::var("HYPRLAND_INSTANCE_SIGNATURE").is_err() {
        return;
    }

    let keybinds: &[(&str, &str)] = &[
        ("CTRL ALT, W",    "quick-tray"),
        ("CTRL ALT, down", "append-clip"),
        ("CTRL ALT, up",   "prepend-clip"),
        ("CTRL ALT, C",    "analyze-image"),
    ];

    for (combo, msg) in keybinds {
        // Unbind first to avoid accumulating duplicate bindings across restarts.
        let _ = std::process::Command::new("hyprctl")
            .args(["keyword", "unbind", combo])
            .output();

        let trigger = format!(
            "python3 -c \"import socket; s=socket.socket(socket.AF_UNIX); \
             s.connect('{SOCKET_PATH}'); s.send(b'{msg}'); s.close()\"",
        );
        let bind_arg = format!("{combo}, exec, {trigger}");
        match std::process::Command::new("hyprctl")
            .args(["keyword", "bind", &bind_arg])
            .output()
        {
            Ok(out) => eprintln!(
                "[hyprland] bind {combo}: {} {}",
                String::from_utf8_lossy(&out.stdout).trim(),
                String::from_utf8_lossy(&out.stderr).trim(),
            ),
            Err(e) => eprintln!("[hyprland] failed to register bind {combo}: {e}"),
        }
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .manage(PrevWindow(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            confirm_paste,
            dismiss_quicktray,
            hide_main_window,
            analyze_clipboard_image,
            get_llm_env_config,
        ])
        .setup(|app| {
            start_ipc_server(app.handle().clone());
            register_hyprland_keybind();

            // ── System tray ───────────────────────────────────────────────
            let open_item = MenuItemBuilder::new("Open Weaver").id("open").build(app)?;
            let quit_item = MenuItemBuilder::new("Quit").id("quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&open_item)
                .separator()
                .item(&quit_item)
                .build()?;

            let icon_bytes = include_bytes!("../icons/32x32.png");
            let tray_icon = if let Ok(decoded) = image::load_from_memory(icon_bytes) {
                let rgba = decoded.to_rgba8();
                let (w, h) = rgba.dimensions();
                tauri::image::Image::new_owned(rgba.into_raw(), w, h)
            } else {
                app.default_window_icon().unwrap().clone()
            };

            TrayIconBuilder::with_id("weaver-tray-v2")
                .icon(tray_icon)
                .menu(&menu)
                .tooltip("Weaver — Clipboard Manager\nCtrl+Alt+W to quick paste")
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        let _ = std::fs::remove_file(SOCKET_PATH);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        toggle_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
