import React from "react";
import { useTheme } from "../theme/ThemeContext";
import { SunIcon, MoonIcon, MonitorIcon } from "./icons";

export default function ThemeToggle({ compact = false }) {
  const { themeMode, cycleThemeMode, setThemeMode } = useTheme();

  const getIcon = () => {
    switch (themeMode) {
      case "light":
        return <SunIcon size={14} className="theme-icon text-amber-500" />;
      case "dark":
        return <MoonIcon size={14} className="theme-icon text-indigo-400" />;
      default:
        return <MonitorIcon size={14} className="theme-icon text-cyan-400" />;
    }
  };

  const getLabel = () => {
    switch (themeMode) {
      case "light":
        return "Light";
      case "dark":
        return "Dark";
      default:
        return "System";
    }
  };

  if (compact) {
    return (
      <button
        className="btn-theme-toggle btn-theme-compact"
        onClick={cycleThemeMode}
        title={`Theme: ${getLabel()} (click to cycle)`}
        aria-label="Toggle theme mode"
      >
        {getIcon()}
      </button>
    );
  }

  return (
    <div className="theme-segmented-control" title="Color Mode">
      <button
        className={`theme-segment ${themeMode === "system" ? "active" : ""}`}
        onClick={() => setThemeMode("system")}
        title="Match Device System Theme"
      >
        <MonitorIcon size={13} />
        <span>Auto</span>
      </button>
      <button
        className={`theme-segment ${themeMode === "dark" ? "active" : ""}`}
        onClick={() => setThemeMode("dark")}
        title="Dark Mode"
      >
        <MoonIcon size={13} />
        <span>Dark</span>
      </button>
      <button
        className={`theme-segment ${themeMode === "light" ? "active" : ""}`}
        onClick={() => setThemeMode("light")}
        title="Light Mode"
      >
        <SunIcon size={13} />
        <span>Light</span>
      </button>
    </div>
  );
}
