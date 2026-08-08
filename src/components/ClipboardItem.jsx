import React, { useState } from "react";
import {
  CopyIcon,
  CheckIcon,
  TrashIcon,
  EditIcon,
  ExpandIcon,
  ShrinkIcon,
} from "./icons";

export default function ClipboardItem({
  item,
  index,
  onCopy,
  onDelete,
  onUpdate,
}) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(item.text);
  const [isExpanded, setIsExpanded] = useState(false);

  const handleCopy = async () => {
    await onCopy(item.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleSaveEdit = () => {
    if (onUpdate && editText !== item.text) {
      onUpdate(index, editText);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditText(item.text);
    setIsEditing(false);
  };

  const lineCount = item.text ? item.text.split("\n").length : 1;
  const isMultiline = lineCount > 1;
  const charLength = item.text ? item.text.length : 0;
  const isLong = charLength > 300 || lineCount > 7;

  return (
    <article className={`clip-item ${isExpanded ? "item-expanded" : ""}`}>
      <div className="clip-header">
        <div className="clip-meta">
          <span className="clip-index">#{index + 1}</span>
          <span className="clip-time">{item.time}</span>
          {isMultiline && (
            <span className="clip-badge badge-lines">{lineCount} lines</span>
          )}
          {charLength > 150 && (
            <span className="clip-badge badge-chars">{charLength} chars</span>
          )}
        </div>

        <div className="clip-actions">
          {isLong && !isEditing && (
            <button
              className="btn-action btn-expand"
              onClick={() => setIsExpanded(!isExpanded)}
              title={isExpanded ? "Collapse height" : "Expand view"}
            >
              {isExpanded ? <ShrinkIcon size={14} /> : <ExpandIcon size={14} />}
              <span>{isExpanded ? "Collapse" : "Expand"}</span>
            </button>
          )}

          {!isEditing ? (
            <button
              className="btn-action btn-edit"
              onClick={() => {
                setEditText(item.text);
                setIsEditing(true);
              }}
              title="Edit text"
            >
              <EditIcon size={14} />
              <span>Edit</span>
            </button>
          ) : (
            <>
              <button
                className="btn-action btn-save"
                onClick={handleSaveEdit}
                title="Save changes"
              >
                <CheckIcon size={14} />
                <span>Save</span>
              </button>
              <button
                className="btn-action btn-cancel"
                onClick={handleCancelEdit}
                title="Cancel editing"
              >
                <span>Cancel</span>
              </button>
            </>
          )}

          <button
            className={`btn-action btn-copy ${copied ? "btn-copied" : ""}`}
            onClick={handleCopy}
            title={copied ? "Copied to clipboard!" : "Copy to clipboard"}
          >
            {copied ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </button>

          <button
            className="btn-action btn-delete"
            onClick={() => onDelete(index)}
            title="Delete entry from history"
          >
            <TrashIcon size={14} />
          </button>
        </div>
      </div>

      <div className="clip-content">
        {isEditing ? (
          <textarea
            className="clip-edit-textarea"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            rows={Math.min(12, Math.max(4, lineCount))}
            autoFocus
          />
        ) : (
          <pre
            className={`clip-text ${isExpanded ? "text-expanded" : ""}`}
            onDoubleClick={() => {
              setEditText(item.text);
              setIsEditing(true);
            }}
            title="Double-click to edit"
          >
            {item.text}
          </pre>
        )}
      </div>
    </article>
  );
}
