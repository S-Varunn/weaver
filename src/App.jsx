import { useState, useEffect, useRef, useCallback } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { load } from "@tauri-apps/plugin-store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

const MAX_HISTORY = 200;
const POLL_INTERVAL_MS = 500;
const STORE_FILE = "clipboard-history.json";
const STORE_KEY = "history";

function ClipboardItem({ item, index, onCopy, onDelete }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await onCopy(item.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const preview = item.text.length > 200 ? item.text.slice(0, 200) + "\u2026" : item.text;
  const lineCount = item.text.split("\n").length;
  const isMultiline = lineCount > 1;

  return (
    <div className="clip-item">
      <div className="clip-meta">
        <span className="clip-index">#{index + 1}</span>
        <span className="clip-time">{item.time}</span>
        {isMultiline && <span className="clip-badge">{lineCount} lines</span>}
        {item.text.length > 200 && (
          <span className="clip-badge">{item.text.length} chars</span>
        )}
      </div>
      <pre className="clip-text">{preview}</pre>
      <div className="clip-actions">
        <button className={`btn-copy ${copied ? "btn-copied" : ""}`} onClick={handleCopy}>
          {copied ? "Copied" : "Copy"}
        </button>
        <button className="btn-delete" onClick={() => onDelete(index)}>
          Delete
        </button>
      </div>
    </div>
  );
}

function App() {
  const [history, setHistory] = useState([]);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const lastTextRef = useRef(null);
  const intervalRef = useRef(null);
  const storeRef = useRef(null);

  // Load persisted history on mount
  useEffect(() => {
    (async () => {
      try {
        const store = await load(STORE_FILE, { autoSave: false });
        storeRef.current = store;
        const saved = await store.get(STORE_KEY);
        if (Array.isArray(saved) && saved.length > 0) {
          setHistory(saved);
          lastTextRef.current = saved[0].text;
        }
      } catch (e) {
        console.error("Failed to load store:", e);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  // Persist whenever history changes
  useEffect(() => {
    if (!ready || !storeRef.current) return;
    (async () => {
      try {
        await storeRef.current.set(STORE_KEY, history);
        await storeRef.current.save();
      } catch (e) {
        console.error("Failed to save store:", e);
      }
    })();
  }, [history, ready]);

  const addToHistory = useCallback((text) => {
    setHistory((prev) => {
      if (prev.length > 0 && prev[0].text === text) return prev;
      const now = new Date();
      const time = now.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      const newEntry = { text, time, id: Date.now() };
      return [newEntry, ...prev].slice(0, MAX_HISTORY);
    });
  }, []);

  const pollClipboard = useCallback(async () => {
    try {
      const text = await readText();
      setError(null);
      if (text && text !== lastTextRef.current) {
        lastTextRef.current = text;
        addToHistory(text);
      }
    } catch (e) {
      const msg = String(e);
      // Suppress expected benign errors across platforms
      if (
        !msg.toLowerCase().includes("empty") &&
        !msg.toLowerCase().includes("no text") &&
        !msg.toLowerCase().includes("couldn't convert")
      ) {
        setError(msg);
      }
    }
  }, [addToHistory]);

  useEffect(() => {
    if (!ready) return;
    if (paused) {
      clearInterval(intervalRef.current);
    } else {
      pollClipboard();
      intervalRef.current = setInterval(pollClipboard, POLL_INTERVAL_MS);
    }
    return () => clearInterval(intervalRef.current);
  }, [paused, pollClipboard, ready]);

  // Listen for merge-clipboard events emitted by the Rust backend when the
  // user triggers Ctrl+Alt+Down (append) or Ctrl+Alt+Up (prepend).
  //
  // Rust has already written the merged text to the clipboard before emitting.
  // Our job here is just to update history: replace the base entry with the
  // merged one, and ensure the selected text never appears as its own entry.
  useEffect(() => {
    let unlisten;
    listen("merge-clipboard", (event) => {
      const { base, merged } = event.payload;

      // Update lastTextRef so the poller treats the merged text as the
      // current clipboard and does not add it as a duplicate entry.
      lastTextRef.current = merged;

      setHistory((prev) => {
        const now = new Date();
        const time = now.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        const mergedEntry = { text: merged, time, id: Date.now() };

        // Replace the base entry with the merged entry.
        const rest = prev.filter((item) => item.text !== base && item.text !== merged);
        return [mergedEntry, ...rest].slice(0, MAX_HISTORY);
      });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => { if (unlisten) unlisten(); };
  }, []);

  const handleCopy = async (text) => {
    try {
      await writeText(text);
    } catch {
      try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
    }
  };

  const handleDelete = (realIndex) => {
    setHistory((prev) => prev.filter((_, i) => i !== realIndex));
  };

  const handleClearAll = () => setHistory([]);


  const filtered = search.trim()
    ? history.filter((item) =>
        item.text.toLowerCase().includes(search.trim().toLowerCase())
      )
    : history;

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          <h1 className="app-title">Weaver</h1>
          <div className="header-actions">
            <button
              className={`btn-pill ${paused ? "btn-resume" : "btn-pause"}`}
              onClick={() => setPaused((p) => !p)}
            >
              {paused ? "Resume" : "Pause"}
            </button>
            {history.length > 0 && (
              <button className="btn-pill btn-clear" onClick={handleClearAll}>
                Clear all
              </button>
            )}
            <button
              className="btn-pill btn-hide"
              onClick={() => getCurrentWindow().hide()}
              title="Hide to system tray"
            >
              Hide
            </button>
          </div>
        </div>

        <input
          className="search-input"
          type="text"
          placeholder="Search clipboard history"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="status-bar">
          <span className={`status-dot ${paused ? "dot-paused" : "dot-active"}`} />
          <span className="status-text">
            {paused ? "Paused" : "Watching clipboard"}
          </span>
          <span className="status-count">
            {filtered.length} / {history.length} entries
          </span>
        </div>
      </header>

      {error && <div className="error-banner">Clipboard error: {error}</div>}

      <main className="clip-list">
        {filtered.length === 0 ? (
          <div className="empty-state">
            {history.length === 0
              ? "Start copying — entries will appear here and persist across sessions."
              : "No results match your search."}
          </div>
        ) : (
          filtered.map((item, i) => (
            <ClipboardItem
              key={item.id}
              item={item}
              index={i}
              onCopy={handleCopy}
              onDelete={() => {
                const realIndex = history.findIndex((h) => h.id === item.id);
                handleDelete(realIndex);
              }}
            />
          ))
        )}
      </main>
    </div>
  );
}

export default App;

