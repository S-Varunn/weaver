import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import QuickTrayWindow from "./QuickTrayWindow";

const isQuickTray = new URLSearchParams(window.location.search).has("quicktray");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isQuickTray ? <QuickTrayWindow /> : <App />}
  </React.StrictMode>,
);
