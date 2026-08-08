import React, { useState } from "react";
import { SparklesIcon, CloseIcon, CheckIcon, CopyIcon } from "./icons";

export default function ImagePreviewModal({
  loading,
  error,
  text,
  setText,
  onAction,
  onClose,
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await onAction("copy");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const lineCount = text ? text.split("\n").length : 0;
  const charLength = text ? text.length : 0;

  return (
    <div className="ocr-modal-backdrop" onClick={onClose}>
      <div className="ocr-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="ocr-modal-header">
          <div className="ocr-header-left">
            <div className="ocr-sparkle-icon">
              <SparklesIcon size={18} />
            </div>
            <div className="ocr-header-text">
              <div className="ocr-title-row">
                <h2 className="ocr-title">AI Image Text Extraction</h2>
                <span className="ocr-model-tag">qwen2.5vl:7b</span>
              </div>
              <span className="ocr-subtitle">Extracted text from clipboard image</span>
            </div>
          </div>

          <button className="btn-icon-close" onClick={onClose} title="Close modal (Esc)">
            <CloseIcon size={14} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="ocr-modal-body">
          {loading && (
            <div className="ocr-loading-box">
              <div className="ocr-spinner" />
              <div className="ocr-loading-text">
                <strong>Analyzing Clipboard Image...</strong>
                <span>Processing vision model request</span>
              </div>
            </div>
          )}

          {error && (
            <div className="ocr-error-banner">
              <strong>Extraction Error:</strong> {error}
            </div>
          )}

          {!loading && (
            <div className="ocr-textarea-container">
              <textarea
                className="ocr-textarea"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="No text detected in clipboard image..."
                rows={8}
                autoFocus
              />
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="ocr-modal-footer">
          <div className="ocr-stats-group">
            {charLength > 0 && (
              <>
                <span className="ocr-stat-pill">{lineCount} {lineCount === 1 ? "line" : "lines"}</span>
                <span className="ocr-stat-pill">{charLength} chars</span>
              </>
            )}
          </div>

          <div className="ocr-actions-group">
            <button
              className={`btn-pill ${copied ? "btn-copied" : "btn-resume"}`}
              onClick={handleCopy}
              disabled={!text || loading}
              title="Copy extracted text to clipboard"
            >
              {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
              <span>{copied ? "Copied!" : "Copy"}</span>
            </button>

            <button
              className="btn-pill btn-pause"
              onClick={() => onAction("append")}
              disabled={!text || loading}
              title="Append extracted text to current clipboard text"
            >
              Append
            </button>

            <button
              className="btn-pill btn-pause"
              onClick={() => onAction("prepend")}
              disabled={!text || loading}
              title="Prepend extracted text before current clipboard text"
            >
              Prepend
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
