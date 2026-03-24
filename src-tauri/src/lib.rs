use std::io::Read;
use std::os::unix::net::UnixListener;
use std::sync::Mutex;
use tauri::{Emitter,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, State,
};

const SOCKET_PATH: &str = "/tmp/weaver.sock";

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

/// Simulate Ctrl+V in the currently focused window.
/// Uses `wtype` on Wayland and `xdotool` on X11.
fn send_paste_key() {
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

/// Read the current clipboard text using `wl-paste` (Wayland) or `xclip` (X11).
fn read_clipboard_text() -> Option<String> {
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

/// Write text to the system clipboard using `wl-copy` (Wayland) or `xclip` (X11).
fn write_clipboard(text: &str) -> Result<(), String> {
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
                            "quick-tray" => show_weaver(&app_handle),
                            "toggle" => toggle_window(&app_handle),
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
    tauri::Builder::default()
        .manage(PrevWindow(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![confirm_paste, dismiss_quicktray])
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

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
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
