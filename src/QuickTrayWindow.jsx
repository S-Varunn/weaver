import { useState, useEffect, useCallback } from "react";
import { load } from "@tauri-apps/plugin-store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

import { ThemeProvider } from "./theme/ThemeContext";
import QuickTray from "./QuickTray";
import "./App.css";

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

/**
 * Rendered in the dedicated `quicktray` window (/?quicktray=1).
 * Loads clipboard history from the shared store and mounts QuickTray.
 */
function QuickTrayContent() {
  const [history, setHistory] = useState([]);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [imageAnalysisLoading, setImageAnalysisLoading] = useState(false);
  const [imageAnalysisError, setImageAnalysisError] = useState(null);
  const [imageAnalyzedText, setImageAnalyzedText] = useState("");
  const [llmConfig, setLlmConfig] = useState(DEFAULT_LLM_CONFIG);

  useEffect(() => {
    document.body.classList.add("quicktray-mode");
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const store = await load(STORE_FILE, { autoSave: false });
      const saved = await store.get(STORE_KEY);
      setHistory(Array.isArray(saved) ? saved : []);
    } catch (e) {
      console.error("[quicktray] failed to load history:", e);
    }
  }, []);

  const loadLlmConfig = useCallback(async () => {
    try {
      const store = await load(STORE_FILE, { autoSave: false });
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
    } catch (e) {
      console.error("[quicktray] failed to load llm config:", e);
      setLlmConfig(DEFAULT_LLM_CONFIG);
    }
  }, []);

  useEffect(() => {
    loadHistory();
    loadLlmConfig();

    let unlisten;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) {
          loadHistory();
          loadLlmConfig();
        }
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadHistory, loadLlmConfig]);

  const analyzeClipboardImage = useCallback(async () => {
    setImagePreviewOpen(true);
    setImageAnalysisLoading(true);
    setImageAnalysisError(null);
    setImageAnalyzedText("");

    try {
      const text = await invoke("analyze_clipboard_image", {
        endpoint: llmConfig.endpoint.trim() || null,
        apiKey: llmConfig.apiKey.trim() || null,
        model: llmConfig.model.trim() || null,
        systemPrompt: llmConfig.systemPrompt.trim() || null,
      });

      setImageAnalyzedText(String(text || ""));
      setImageAnalysisError(null);
    } catch (e) {
      setImageAnalysisError(String(e));
    } finally {
      setImageAnalysisLoading(false);
    }
  }, [llmConfig]);

  useEffect(() => {
    let unlisten;
    listen("analyze-image-shortcut", () => {
      analyzeClipboardImage();
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [analyzeClipboardImage]);

  const handleImagePreviewAction = async (action) => {
    const text = imageAnalyzedText.trim();
    if (!text) return;

    let out = text;
    if (action === "append" || action === "prepend") {
      let base = "";
      try {
        base = (await readText()) || "";
      } catch {
        base = "";
      }

      out = base.trim()
        ? action === "append"
          ? `${base}\n${text}`
          : `${text}\n${base}`
        : text;
    }

    try {
      await writeText(out);
    } catch (e) {
      setImageAnalysisError(String(e));
      return;
    }

    setImagePreviewOpen(false);
    await loadHistory();
  };

  return (
    <QuickTray
      history={history}
      onClose={() => {}}
      imagePreviewOpen={imagePreviewOpen}
      imageAnalysisLoading={imageAnalysisLoading}
      imageAnalysisError={imageAnalysisError}
      imageAnalyzedText={imageAnalyzedText}
      setImageAnalyzedText={setImageAnalyzedText}
      onImageAction={handleImagePreviewAction}
      onCloseImagePreview={() => setImagePreviewOpen(false)}
    />
  );
}

export default function QuickTrayWindow() {
  return (
    <ThemeProvider>
      <QuickTrayContent />
    </ThemeProvider>
  );
}
