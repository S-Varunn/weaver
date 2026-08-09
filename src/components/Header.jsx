import React from "react";
import ThemeToggle from "./ThemeToggle";
import {
  ClipboardIcon,
  PauseIcon,
  PlayIcon,
  ClearIcon,
  SettingsIcon,
  HideIcon,
} from "./icons";

export default function Header({
  paused,
  onTogglePause,
  historyCount,
  onClearAll,
  showLlmSettings,
  onToggleLlmSettings,
  onHideWindow,
}) {
  return (
    <header className="app-header">
      <div className="header-top">
        <div className="brand-group">
          <div className="brand-icon-wrapper">
            <img src="/app-icon.png" alt="Weaver Icon" className="brand-icon-img" />
          </div>
          <div className="brand-title-area">
            <h1 className="app-title">Weaver</h1>
            <div className="status-indicator">
              <span className={`status-dot ${paused ? "dot-paused" : "dot-active"}`} />
              <span className="status-label">{paused ? "Paused" : "Active"}</span>
            </div>
          </div>
        </div>

        <div className="header-actions">
          <ThemeToggle />

          <button
            className={`btn-pill ${paused ? "btn-resume" : "btn-pause"}`}
            onClick={onTogglePause}
            title={paused ? "Resume clipboard monitoring" : "Pause clipboard monitoring"}
          >
            {paused ? <PlayIcon size={13} /> : <PauseIcon size={13} />}
            <span>{paused ? "Resume" : "Pause"}</span>
          </button>

          {historyCount > 0 && (
            <button
              className="btn-pill btn-clear"
              onClick={onClearAll}
              title="Clear all clipboard entries"
            >
              <ClearIcon size={13} />
              <span>Clear</span>
            </button>
          )}

          <button
            className={`btn-pill ${showLlmSettings ? "btn-active-tool" : "btn-pause"}`}
            onClick={onToggleLlmSettings}
            title="Configure LLM Vision / OCR settings"
          >
            <SettingsIcon size={13} />
            <span>AI OCR</span>
          </button>

          <button
            className="btn-pill btn-hide"
            onClick={onHideWindow}
            title="Minimize to system tray"
          >
            <HideIcon size={13} />
            <span>Hide</span>
          </button>
        </div>
      </div>
    </header>
  );
}
