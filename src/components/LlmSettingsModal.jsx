import React from "react";
import { SparklesIcon, CloseIcon } from "./icons";

export default function LlmSettingsModal({
  config,
  onChange,
  onClose,
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="llm-settings-card" onClick={(e) => e.stopPropagation()}>
        <div className="llm-card-header">
          <div className="llm-header-title">
            <SparklesIcon size={16} className="text-purple-400" />
            <h2>AI Image OCR Settings</h2>
          </div>
          <button className="btn-icon-close" onClick={onClose} title="Close settings">
            <CloseIcon size={14} />
          </button>
        </div>

        <div className="llm-settings-grid">
          <label className="llm-field">
            <span className="field-label">LLM API Endpoint</span>
            <input
              className="settings-input"
              type="text"
              value={config.endpoint}
              onChange={(e) => onChange("endpoint", e.target.value)}
              placeholder="http://localhost:11434/v1/chat/completions"
            />
          </label>

          <label className="llm-field">
            <span className="field-label">Model Name</span>
            <input
              className="settings-input"
              type="text"
              value={config.model}
              onChange={(e) => onChange("model", e.target.value)}
              placeholder="llava, gpt-4o-mini, llama3-vision..."
            />
          </label>

          <label className="llm-field">
            <span className="field-label">API Key (optional for local Ollama)</span>
            <input
              className="settings-input"
              type="password"
              value={config.apiKey}
              onChange={(e) => onChange("apiKey", e.target.value)}
              placeholder="sk-..."
            />
          </label>

          <label className="llm-field">
            <span className="field-label">System Prompt</span>
            <textarea
              className="settings-textarea"
              value={config.systemPrompt}
              onChange={(e) => onChange("systemPrompt", e.target.value)}
              rows={3}
              placeholder="Extract all text from image..."
            />
          </label>
        </div>

        <div className="llm-card-footer">
          <div className="shortcut-note">
            Shortcut for image analysis: <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd>
          </div>
          <button className="btn-pill btn-resume" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
