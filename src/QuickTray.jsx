import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/**
 * QuickTray — keyboard-driven clipboard picker shown in a dedicated
 * always-on-top window. Selection is confirmed via Enter or click;
 * the Rust `confirm_paste` command handles clipboard write, window
 * hide, focus restore, and key simulation atomically.
 */
export default function QuickTray({
  history,
  onClose,
  imagePreviewOpen,
  imageAnalysisLoading,
  imageAnalysisError,
  imageAnalyzedText,
  setImageAnalyzedText,
  onImageAction,
  onCloseImagePreview,
}) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef(null);
  const selectedItemRef = useRef(null);
  const panelRef = useRef(null);
  const items = history.slice(0, 50);

  // Refs ensure the keydown handler always reads current values
  // without needing to re-register on every render.
  const itemsRef = useRef(items);
  const selectedIndexRef = useRef(selectedIndex);
  useEffect(() => { itemsRef.current = items; }, [items]);
  useEffect(() => { selectedIndexRef.current = selectedIndex; }, [selectedIndex]);

  // Focus the panel as soon as items are available so keyboard works immediately.
  useEffect(() => {
    if (items.length > 0) panelRef.current?.focus();
  }, [items.length]);

  // Scroll the selected item into view.
  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const confirm = (index) => {
    const item = itemsRef.current[index];
    if (!item) return;
    onClose();
    // Rust handles everything: wl-copy → window hide → focus restore → wtype
    invoke("confirm_paste", { text: item.text }).catch((e) => {
      console.error("[quicktray] confirm_paste failed:", e);
    });
  };

  const dismiss = () => {
    onClose();
    invoke("dismiss_quicktray").catch(() => {});
  };

  useEffect(() => {
    const onKeyDown = (e) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, itemsRef.current.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          confirm(selectedIndexRef.current);
          break;
        case "Escape":
          e.preventDefault();
          dismiss();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []); // Empty deps — intentional; relies on refs for current values.

  const renderImagePreview = () => {
    if (!imagePreviewOpen) return null;
    return (
      <section className="image-preview-card qt-image-preview" onClick={(e) => e.stopPropagation()}>
        <div className="image-preview-header">
          <h2>Image Text Preview</h2>
          <button className="btn-pill btn-hide" onClick={onCloseImagePreview}>Close</button>
        </div>

        {imageAnalysisLoading && <div className="image-preview-info">Analyzing image with LLM...</div>}
        {imageAnalysisError && <div className="error-banner">Image analysis error: {imageAnalysisError}</div>}

        <textarea
          className="image-preview-textarea"
          value={imageAnalyzedText}
          onChange={(e) => setImageAnalyzedText(e.target.value)}
          placeholder="Analyzed text will appear here."
        />

        <div className="image-preview-actions">
          <button className="btn-pill btn-resume" onClick={() => onImageAction("copy")}>Copy</button>
          <button className="btn-pill btn-pause" onClick={() => onImageAction("append")}>Append</button>
          <button className="btn-pill btn-pause" onClick={() => onImageAction("prepend")}>Prepend</button>
        </div>
      </section>
    );
  };

  if (items.length === 0) {
    return (
      <div className="qt-backdrop" onClick={dismiss}>
        <div className="qt-panel">
          {renderImagePreview()}
          <p className="qt-empty">No clipboard history yet.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="qt-backdrop" onClick={dismiss}>
      <div
        ref={panelRef}
        className="qt-panel"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{ outline: "none" }}
      >
        <div className="qt-header">
          <span className="qt-title">Quick Paste</span>
          <span className="qt-hint">Arrow keys to navigate &middot; Enter or click to paste &middot; Esc to dismiss</span>
        </div>
        {renderImagePreview()}
        <ul className="qt-list" ref={listRef}>
          {items.map((item, i) => {
            const preview = item.text.length > 120
              ? item.text.slice(0, 120) + "\u2026"
              : item.text;
            const isSelected = i === selectedIndex;
            return (
              <li
                key={item.id}
                ref={isSelected ? selectedItemRef : null}
                className={`qt-item ${isSelected ? "qt-item--selected" : ""}`}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={(e) => { e.stopPropagation(); confirm(i); }}
              >
                <span className="qt-item-index">{i + 1}</span>
                <span className="qt-item-preview">{preview}</span>
                <span className="qt-item-time">{item.time}</span>
              </li>
            );
          })}
        </ul>
        <div className="qt-footer">
          <span>{items.length} item{items.length !== 1 ? "s" : ""}</span>
          <span>Enter or click to paste</span>
        </div>
      </div>
    </div>
  );
}
