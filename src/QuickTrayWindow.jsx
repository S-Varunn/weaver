import { useState, useEffect } from "react";
import { load } from "@tauri-apps/plugin-store";
import { getCurrentWindow } from "@tauri-apps/api/window";
import QuickTray from "./QuickTray";
import "./App.css";

const STORE_FILE = "clipboard-history.json";
const STORE_KEY = "history";

/**
 * Rendered in the dedicated `quicktray` window (/?quicktray=1).
 * Loads clipboard history from the shared store and mounts QuickTray.
 * History is refreshed each time the window regains focus.
 */
export default function QuickTrayWindow() {
  const [history, setHistory] = useState([]);

  // Mark body so CSS removes the backdrop overlay in standalone mode.
  useEffect(() => {
    document.body.classList.add("quicktray-mode");
  }, []);

  const loadHistory = async () => {
    try {
      const store = await load(STORE_FILE, { autoSave: false });
      const saved = await store.get(STORE_KEY);
      if (Array.isArray(saved) && saved.length > 0) {
        setHistory(saved);
      }
    } catch (e) {
      console.error("[quicktray] failed to load history:", e);
    }
  };

  useEffect(() => {
    loadHistory();

    let unlisten;
    getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) loadHistory();
      })
      .then((fn) => { unlisten = fn; });

    return () => { if (unlisten) unlisten(); };
  }, []);

  return <QuickTray history={history} onClose={() => {}} />;
}
