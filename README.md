# Weaver

Weaver is a desktop clipboard manager built with Tauri 2 and React. It provides:

- Persistent clipboard history
- A fast quick-paste picker window
- System tray operation (runs in the background)
- Hyprland-friendly global keybind behavior via IPC
- Append/prepend composition using highlighted text without copying it directly

## Table of Contents

- [Overview](#overview)
- [Core Features](#core-features)
- [Technology Stack](#technology-stack)
- [Requirements](#requirements)
- [Installation](#installation)
- [Running in Development](#running-in-development)
- [Usage](#usage)
- [Architecture](#architecture)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Troubleshooting](#troubleshooting)

## Overview

Weaver is designed for Linux desktop workflows where quick keyboard-driven paste and history navigation are important. The app runs with a hidden main window, exposes controls through a tray icon, and opens a dedicated transparent quick-paste window when requested.

For Hyprland/Wayland compatibility, Weaver uses a Unix domain socket plus compositor keybinds, instead of relying only on in-app global shortcut listeners.

## Core Features

- Clipboard polling with deduplicated history
- Searchable clipboard list with copy and delete actions
- Persistent history storage across app restarts
- Quick-paste overlay with keyboard navigation
- Append/prepend workflow using highlighted text:
	- Copy text A normally
	- Highlight text B (do not copy)
	- Append or prepend B to A using shortcut keys
	- Clipboard becomes merged content; highlighted text does not enter history as a standalone copied item

## Technology Stack

- Frontend: React 18 + Vite
- Desktop runtime: Tauri 2 (Rust backend)
- Tauri plugins:
	- `@tauri-apps/plugin-clipboard-manager`
	- `@tauri-apps/plugin-store`
	- `@tauri-apps/plugin-opener`
- Platform integrations:
	- Wayland utilities: `wl-copy`, `wl-paste`, `wtype`
	- Hyprland utility: `hyprctl`
	- IPC: Unix socket at `/tmp/weaver.sock`

## Requirements

### General

- Node.js (LTS recommended)
- `pnpm`
- Rust toolchain (`rustup`, `cargo`)
- System dependencies required by Tauri for Linux builds

### Wayland / Hyprland Workflow

Install these utilities if you want all keyboard integrations to work:

- `wl-clipboard` (provides `wl-copy`, `wl-paste`)
- `wtype`
- `hyprctl` (from Hyprland)
- `python3` (used for lightweight IPC trigger command)

### X11 Fallback Utilities

- `xclip`
- `xdotool`

## Installation

```bash
pnpm install
```

## Environment Configuration

Weaver reads LLM defaults from `.env` in the project root.

1. Copy the template:

```bash
cp .env.example .env
```

2. Configure values as needed:

- `WEAVER_LLM_ENDPOINT`
- `WEAVER_LLM_MODEL`
- `WEAVER_LLM_API_KEY`
- `WEAVER_LLM_SYSTEM_PROMPT`

The UI settings panel is still editable; values from `.env` are used as defaults.

## Running in Development

Run the full Tauri app:

```bash
pnpm tauri dev
```

Build frontend assets:

```bash
pnpm build
```

Run Rust compile check only:

```bash
cd src-tauri
cargo check
```

## Usage

### Clipboard History

- Open Weaver from the tray menu
- Clipboard entries are captured automatically
- Use search to filter history
- Use copy/delete controls on each item

### Quick Paste Picker

- Trigger the quick picker shortcut
- Navigate with arrow keys
- Press Enter to paste selection into the previously focused app
- Press Escape to dismiss

### Append/Prepend Merge Workflow

This is implemented to avoid creating standalone clipboard entries for intermediate text:

1. Copy base text A (`Ctrl+C`)
2. Highlight text B (without copying)
3. Press append shortcut to produce `A + "\n" + B`
4. Or highlight text C and press prepend shortcut to produce `C + "\n" + A`

Only merged output is written back to clipboard/history in this workflow.

## Architecture

### Frontend (React)

- `App.jsx`: main clipboard history UI
- `QuickTray.jsx`: quick picker component
- `QuickTrayWindow.jsx`: dedicated quicktray window entry point
- Store persistence through Tauri Store plugin

### Backend (Rust / Tauri)

- Main runtime and tray handling in `src-tauri/src/lib.rs`
- Dedicated commands for paste confirmation and dismiss
- IPC server listens on `/tmp/weaver.sock`
- Hyprland keybinds are registered at startup
- Duplicate keybind accumulation is prevented by unbinding before binding

### Windows

- `main`: hidden by default, standard app UI
- `quicktray`: transparent always-on-top picker window

## Keyboard Shortcuts

Default Hyprland runtime bindings:

- `Ctrl+Alt+W`: open quick-paste picker
- `Ctrl+Alt+Down`: append highlighted text to current clipboard text
- `Ctrl+Alt+Up`: prepend highlighted text to current clipboard text

## Troubleshooting

### Port 1420 is already in use

Vite dev server runs on port `1420` during `pnpm tauri dev`.
If the port is occupied, stop the previous process and restart.

### Shortcut action fires multiple times

This usually means duplicate compositor binds were previously registered.
Weaver now unbinds before binding at startup; restart the app to normalize binds.

### Clipboard merge does not work on Wayland

Check availability of:

- `wl-copy`
- `wl-paste`
- `wtype`
- `hyprctl`

### Rust compiles but app startup fails

Run both layers separately to isolate issues:

```bash
pnpm dev
cd src-tauri && cargo check
```

## License

This project currently does not declare a license file. Add one if you plan to distribute publicly.
