import { useState, useEffect, useRef, useCallback } from "react";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { load } from "@tauri-apps/plugin-store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

import { ThemeProvider } from "./theme/ThemeContext";
import Header from "./components/Header";
import SearchBar from "./components/SearchBar";
import ClipboardItem from "./components/ClipboardItem";
import LlmSettingsModal from "./components/LlmSettingsModal";
import { ClipboardIcon } from "./components/icons";

import "./App.css";

const MAX_HISTORY = 200;
const POLL_INTERVAL_MS = 500;
const STORE_FILE = "clipboard-history.json";
const STORE_KEY = "history";
const LLM_CONFIG_KEY = "llmConfig";

const DEFAULT_LLM_CONFIG = {
  endpoint: "http://localhost:11434/v1/chat/completions",
  model: "qwen2.5vl:7b",
  apiKey: "",
  systemPrompt: "Perform OCR on this image. Transcribe all text, code, and symbols line by line exactly as shown. Do not skip any lines, summarize, or add commentary. Return raw text only.",
};

const normalizeString = (value) => (typeof value === "string" ? value : "");

function AppContent() {
  const [history, setHistory] = useState([]);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);
  const [showLlmSettings, setShowLlmSettings] = useState(false);
  const [llmConfig, setLlmConfig] = useState(DEFAULT_LLM_CONFIG);

  const lastTextRef = useRef(null);
  const intervalRef = useRef(null);
  const storeRef = useRef(null);

  // Load persisted history & configuration on mount
  useEffect(() => {
    (async () => {
      try {
        const store = await load(STORE_FILE, { autoSave: false });
        storeRef.current = store;
        const saved = await store.get(STORE_KEY);
        const savedLlmConfig = await store.get(LLM_CONFIG_KEY);
        const envLlmConfig = await invoke("get_llm_env_config").catch(() => null);

        const envEndpoint = normalizeString(envLlmConfig?.endpoint);
        const envModel = normalizeString(envLlmConfig?.model);
        const envApiKey = envLlmConfig?.api_key !== undefined ? normalizeString(envLlmConfig?.api_key) : null;
        const envPrompt = normalizeString(envLlmConfig?.system_prompt);

        const resolvedConfig = {
          endpoint: envEndpoint || normalizeString(savedLlmConfig?.endpoint) || DEFAULT_LLM_CONFIG.endpoint,
          model: envModel || normalizeString(savedLlmConfig?.model) || DEFAULT_LLM_CONFIG.model,
          apiKey: envApiKey !== null ? envApiKey : (normalizeString(savedLlmConfig?.apiKey) || DEFAULT_LLM_CONFIG.apiKey),
          systemPrompt: envPrompt || normalizeString(savedLlmConfig?.systemPrompt) || DEFAULT_LLM_CONFIG.systemPrompt,
        };

        setLlmConfig(resolvedConfig);

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

  // Persist whenever history or llmConfig changes
  useEffect(() => {
    if (!ready || !storeRef.current) return;
    (async () => {
      try {
        await storeRef.current.set(STORE_KEY, history);
        await storeRef.current.set(LLM_CONFIG_KEY, llmConfig);
        await storeRef.current.save();
      } catch (e) {
        console.error("Failed to save store:", e);
      }
    })();
  }, [history, llmConfig, ready]);

  const getCurrentTime = () => {
    return new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const addToHistory = useCallback((text) => {
    setHistory((prev) => {
      // 1. If text is identical to top item, do nothing
      if (prev.length > 0 && prev[0].text === text) return prev;

      // 2. Exact match check: if this text already exists in history, move it to top with updated time
      const exactIndex = prev.findIndex((item) => item.text === text);
      if (exactIndex !== -1) {
        const item = prev[exactIndex];
        const rest = prev.filter((_, i) => i !== exactIndex);
        return [{ ...item, time: getCurrentTime() }, ...rest];
      }

      // 3. Append / Prepend check: if text is an append or prepend to an existing item in history, update that item in place!
      const appendPrependIndex = prev.findIndex(
        (item) =>
          text.startsWith(item.text + "\n") || text.endsWith("\n" + item.text)
      );

      if (appendPrependIndex !== -1) {
        const targetItem = prev[appendPrependIndex];
        const updatedItem = { ...targetItem, text, time: getCurrentTime() };
        const rest = prev.filter((_, i) => i !== appendPrependIndex);
        return [updatedItem, ...rest];
      }

      // 4. Otherwise, insert new item at top
      const newEntry = { text, time: getCurrentTime(), id: Date.now() };
      return [newEntry, ...prev].slice(0, MAX_HISTORY);
    });
  }, []);

const isImageFilePath = (str) => {
  if (typeof str !== "string") return false;
  const trimmed = str.trim();
  const path = trimmed.startsWith("file://") ? trimmed.slice(7) : trimmed;
  const ext = path.split(".").pop()?.toLowerCase();
  return ["png", "jpg", "jpeg", "webp", "bmp", "x-png"].includes(ext);
};

  const pollClipboard = useCallback(async () => {
    try {
      const text = await readText();
      setError(null);
      if (text && text !== lastTextRef.current) {
        lastTextRef.current = text;
        if (!isImageFilePath(text)) {
          addToHistory(text);
        }
      }
    } catch (e) {
      const msg = String(e);
      // Suppress benign platform clipboard errors
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

  // Listen for Rust backend merge-clipboard events (Ctrl+Alt+Down / Ctrl+Alt+Up)
  useEffect(() => {
    let unlisten;
    listen("merge-clipboard", (event) => {
      const { base, merged } = event.payload;
      lastTextRef.current = merged;

      setHistory((prev) => {
        const now = new Date();
        const time = now.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });
        const mergedEntry = { text: merged, time, id: Date.now() };

        const rest = prev.filter(
          (item) => item.text !== base && item.text !== merged
        );
        return [mergedEntry, ...rest].slice(0, MAX_HISTORY);
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleCopy = async (text) => {
    try {
      await writeText(text);
    } catch {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        /* ignore fallback */
      }
    }
  };

  const handleDelete = (realIndex) => {
    setHistory((prev) => prev.filter((_, i) => i !== realIndex));
  };

  const handleClearAll = () => setHistory([]);

  const handleLlmConfigChange = (key, value) => {
    setLlmConfig((prev) => ({ ...prev, [key]: value }));
  };

  const filtered = search.trim()
    ? history.filter((item) =>
        item.text.toLowerCase().includes(search.trim().toLowerCase())
      )
    : history;

  const handleUpdate = useCallback((realIndex, newText) => {
    setHistory((prev) => {
      const next = [...prev];
      if (next[realIndex]) {
        next[realIndex] = { ...next[realIndex], text: newText };
      }
      return next;
    });
  }, []);

  return (
    <div className="app">
      <Header
        paused={paused}
        onTogglePause={() => setPaused((p) => !p)}
        historyCount={history.length}
        onClearAll={handleClearAll}
        showLlmSettings={showLlmSettings}
        onToggleLlmSettings={() => setShowLlmSettings((v) => !v)}
        onHideWindow={async () => {
          try {
            await invoke("hide_main_window");
          } catch {
            try {
              await getCurrentWindow().hide();
            } catch (e) {
              console.error("[weaver] hide failed:", e);
            }
          }
        }}
      />

      <div style={{ padding: "0 16px 4px 16px" }}>
        <SearchBar
          search={search}
          onSearchChange={setSearch}
          filteredCount={filtered.length}
          totalCount={history.length}
        />
      </div>

      {error && <div className="error-banner">Clipboard issue: {error}</div>}

      <main className="clip-list">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <ClipboardIcon size={40} className="empty-icon" />
            <h3 className="empty-title">
              {history.length === 0 ? "Clipboard is empty" : "No matching results"}
            </h3>
            <p className="empty-desc">
              {history.length === 0
                ? "Copy any text using Ctrl+C — entries will automatically appear here and persist across sessions."
                : "No clipboard entries match your current search query."}
            </p>
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
              onUpdate={(_, newText) => {
                const realIndex = history.findIndex((h) => h.id === item.id);
                handleUpdate(realIndex, newText);
              }}
            />
          ))
        )}
      </main>

      {showLlmSettings && (
        <LlmSettingsModal
          config={llmConfig}
          onChange={handleLlmConfigChange}
          onClose={() => setShowLlmSettings(false)}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}
