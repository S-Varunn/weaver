# Weaver

Weaver is a fast, shortcut based desktop clipboard manager and context composer built with Tauri 2, Rust, and React. I made weaver with the idea to reduce the context switching i do with ai agents. The idea is to make it so that you never have to switch windows to copy and paste context for ai agents.

---

## Overview

Weaver was created specifically to streamline developer workflows with AI agents, LLMs, and multi file coding environments.

When pairing with AI assistants (such as ChatGPT, Claude, Cursor, or local LLMs), developers frequently gather context from disparate sources: error logs from terminal outputs, API types from documentation, database schemas, and code blocks from multiple IDE tabs.

Normally, assembling this context requires heavy window switching:
1. Copy code snippet A in your editor.
2. Alt-Tab to the AI chat window and paste snippet A.
3. Alt-Tab back to the terminal and copy an error log.
4. Alt-Tab back to the AI chat window and paste the error log.
5. Repeat for documentation or additional context.

Weaver eliminates this context switching by introducing **Prompt Weaving**. Without leaving your code editor, terminal, or browser, you can highlight text across multiple windows and use global hotkeys to append or prepend selections into a single unified clipboard entry. Once your prompt is woven together, you switch to your AI agent window once and paste your complete, structured prompt in a single action.

---

## Key Features

### Prompt Weaving (Append & Prepend)
- **Append (`Ctrl+Alt+Down`)**: Select any text on screen and press `Ctrl+Alt+Down` to merge it to the bottom of your current clipboard item.
- **Prepend (`Ctrl+Alt+Up`)**: Select any text on screen and press `Ctrl+Alt+Up` to merge it to the top of your current clipboard item.
- **Clean History**: Highlighted text used during weaving is merged in place and does not pollute your clipboard history with intermediate standalone entries.

### One-Shortcut AI Image OCR (`Ctrl+Alt+C`)
- Click or select any image file (`.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`) in your file manager or browser and press `Ctrl+Alt+C`.
- Weaver reads the image file directly and sends it to a local vision model (`qwen2.5vl:7b` via Ollama) or remote OpenAI-compatible endpoint.
- Transcribes all text, code, and symbols line-by-line without truncating code blocks.
- Intermediate image file paths are automatically excluded from your clipboard history list.

### Floating Quick Paste Palette (`Ctrl+Alt+W`)
- Press `Ctrl+Alt+W` anywhere on your desktop to summon an always-on-top, transparent floating paste picker overlay.
- Search clipboard history in real-time or navigate with arrow keys.
- Press `Enter` or click an item to hide the picker, restore focus to your active window, and automatically send `Ctrl+V`.

### Full Text Scrolling & Expand/Collapse Views
- Code blocks and text entries are rendered in full without truncation (`slice(0, 300)` is removed).
- Integrated smooth vertical scrolling with custom scrollbars.
- Expand / Collapse height toggle button for long entries (up to 480px view height).

### Permanent Inline Editing
- Edit any item in your clipboard history directly by double-clicking the text block or clicking the **Edit** button.
- An interactive monospace text area allows you to modify code snippets before pasting.
- Edits persist permanently to disk, update the system clipboard, and support subsequent append/prepend operations without creating duplicate entries.

### Smart In-Place Matching
- When appending, prepending, or editing an existing history entry, Weaver updates the target entry **in place** and moves it to the top of your history rather than spawning duplicate entries.

### Light, Dark, and Device-Aware Themes
- Automatic device theme detection matching system preference (`prefers-color-scheme`).
- Includes a 3-way segmented toggle (`System`, `Dark`, `Light`) in the main interface.

### Native Linux / Wayland & X11 Integration
- Implements a Unix domain socket server listening at `/tmp/weaver.sock` for reliable compositor shortcut execution on Wayland (Hyprland) and X11.
- Automatically prevents duplicate keybind registrations at startup.

---

## Keyboard Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| `Ctrl + Alt + W` | Toggle Quick Palette | Opens floating transparent picker overlay over active window |
| `Ctrl + Alt + Down` | Append to Clipboard | Merges selected text to the bottom of the active clipboard entry |
| `Ctrl + Alt + Up` | Prepend to Clipboard | Merges selected text to the top of the active clipboard entry |
| `Ctrl + Alt + C` | AI Image OCR Analysis | Transcribes clicked or selected image file into raw text |
| `Enter` / Click | Confirm Paste | Pastes selected item into previously active window and hides picker |
| `Escape` | Dismiss Quick Palette | Hides floating window without pasting |

---

## Technology Stack

- **Frontend**: React 18, Vite, Vanilla CSS custom properties.
- **Backend / Desktop Runtime**: Tauri 2 (Rust), `tauri-plugin-clipboard-manager`, `tauri-plugin-store`.
- **System Integrations**: `wl-clipboard`, `wtype`, `xclip`, `xdotool`, `hyprctl`.
- **IPC Layer**: Unix domain socket server (`/tmp/weaver.sock`).
- **AI Vision Engine**: Local Ollama API endpoint (`qwen2.5vl:7b`) or remote OpenAI Chat Completions API.

---

## Environment Configuration

Weaver loads default LLM settings from a `.env` file in the project root:

1. Copy `.env.sample` to `.env`:
```bash
cp .env.sample .env
```

2. Configure environment variables:
```env
# Ollama or OpenAI-compatible Chat Completions endpoint
WEAVER_LLM_ENDPOINT=http://localhost:11434/v1/chat/completions

# Vision Model ID (e.g. qwen2.5vl:7b, gpt-4o)
WEAVER_LLM_MODEL=qwen2.5vl:7b

# API Key (optional for local Ollama, required for remote OpenAI)
WEAVER_LLM_API_KEY=

# Default OCR instruction prompt
WEAVER_LLM_SYSTEM_PROMPT="Perform OCR on this image. Transcribe all text, code, and symbols line by line exactly as shown. Do not skip any lines, summarize, or add commentary. Return raw text only."
```

Settings configured via the in-app AI OCR settings panel take precedence during runtime.

---

## Installation & Development

### Prerequisites

- Node.js (LTS recommended)
- `pnpm`
- Rust toolchain (`rustup`, `cargo`)
- Linux system build dependencies for Tauri 2

### System Dependencies (Linux)

For Wayland / Hyprland shortcut execution and clipboard operations:

```bash
# Ubuntu / Debian
sudo apt install -y libgtk-3-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf wtype xdotool wl-clipboard xclip
```

### Running Locally

1. Install frontend dependencies:
```bash
pnpm install
```

2. Start the Tauri development application:
```bash
pnpm tauri dev
```

3. Build production installers (`.deb`, `.rpm`, `.AppImage`):
```bash
pnpm tauri build
```

Production installers will be generated in `src-tauri/target/release/bundle/`.

---

## Architecture Overview

```
                          +-------------------------+
                          |   System Clipboard /    |
                          |    Primary Selection    |
                          +------------+------------+
                                       |
                                       v
+------------------------+    +------------------+    +-----------------------+
| Hyprland / X11 Hotkeys | -> | Unix IPC Socket  | -> | Tauri 2 (Rust Core)   |
| (Ctrl+Alt+W/C/Up/Down) |    | /tmp/weaver.sock |    | System Tray / Window  |
+------------------------+    +------------------+    +-----------+-----------+
                                                                  |
                                                                  v
+------------------------+                            +-----------------------+
|  Local Ollama Vision   | <========================= | React 18 Frontend     |
|   (qwen2.5vl:7b)       |     OCR Vision Requests    | (History & QuickTray) |
+------------------------+                            +-----------------------+
```

---

## License

MIT License. See `LICENSE` for details.
