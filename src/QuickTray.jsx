import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ClipboardIcon } from "./components/icons";
import ImagePreviewModal from "./components/ImagePreviewModal";

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

  const itemsRef = useRef(items);
  const selectedIndexRef = useRef(selectedIndex);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(() => {
    selectedIndexRef.current = selectedIndex;
  }, [selectedIndex]);

  useEffect(() => {
    if (items.length > 0) panelRef.current?.focus();
  }, [items.length]);

  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const confirm = (index) => {
    const item = itemsRef.current[index];
    if (!item) return;
    onClose();
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
      if (imagePreviewOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          onCloseImagePreview();
        }
        return;
      }

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
  }, [imagePreviewOpen, onCloseImagePreview]);

  // If OCR image modal is active, render dedicated ImagePreviewModal overlay
  if (imagePreviewOpen) {
    return (
      <ImagePreviewModal
        loading={imageAnalysisLoading}
        error={imageAnalysisError}
        text={imageAnalyzedText}
        setText={setImageAnalyzedText}
        onAction={onImageAction}
        onClose={onCloseImagePreview}
      />
    );
  }

  if (items.length === 0) {
    return (
      <div className="qt-backdrop" onClick={dismiss}>
        <div className="qt-panel">
          <div className="qt-empty">
            <ClipboardIcon size={32} className="empty-icon" />
            <p>No clipboard history yet.</p>
          </div>
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
          <div className="qt-title-group">
            <ClipboardIcon size={16} className="text-indigo-400" />
            <span className="qt-title">Quick Paste</span>
          </div>
          <span className="qt-hint">
            <kbd>↑</kbd> <kbd>↓</kbd> navigate &middot; <kbd>Enter</kbd> paste &middot; <kbd>Esc</kbd> dismiss
          </span>
        </div>

        <ul className="qt-list" ref={listRef}>
          {items.map((item, i) => {
            const preview =
              item.text.length > 130
                ? item.text.slice(0, 130) + "\u2026"
                : item.text;
            const isSelected = i === selectedIndex;
            return (
              <li
                key={item.id}
                ref={isSelected ? selectedItemRef : null}
                className={`qt-item ${isSelected ? "qt-item--selected" : ""}`}
                onMouseEnter={() => setSelectedIndex(i)}
                onClick={(e) => {
                  e.stopPropagation();
                  confirm(i);
                }}
              >
                <span className="qt-item-index">{i + 1}</span>
                <span className="qt-item-preview">{preview}</span>
                <span className="qt-item-time">{item.time}</span>
              </li>
            );
          })}
        </ul>

        <div className="qt-footer">
          <span>{items.length} item{items.length !== 1 ? "s" : ""} in history</span>
          <div className="qt-legend">
            <span>Press <kbd>Enter</kbd> or click to paste</span>
          </div>
        </div>
      </div>
    </div>
  );
}
