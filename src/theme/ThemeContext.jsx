import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

const THEME_STORAGE_KEY = "weaver_theme_mode";

const ThemeContext = createContext({
  themeMode: "system", // 'system' | 'dark' | 'light'
  effectiveTheme: "dark", // 'dark' | 'light'
  setThemeMode: () => {},
  cycleThemeMode: () => {},
});

export function ThemeProvider({ children }) {
  const [themeMode, setThemeModeState] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === "dark" || saved === "light" || saved === "system") {
        return saved;
      }
    } catch {
      /* ignore storage error */
    }
    return "system";
  });

  const [systemTheme, setSystemTheme] = useState(() => {
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "dark";
  });

  // Listen for system theme changes
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };

    try {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    } catch {
      // Fallback for older browsers
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
  }, []);

  const effectiveTheme = themeMode === "system" ? systemTheme : themeMode;

  // Apply data-theme attribute to html root
  useEffect(() => {
    document.documentElement.setAttribute("data-theme", effectiveTheme);
    document.documentElement.classList.remove("dark-theme", "light-theme");
    document.documentElement.classList.add(`${effectiveTheme}-theme`);
  }, [effectiveTheme]);

  const setThemeMode = useCallback((mode) => {
    if (mode !== "system" && mode !== "dark" && mode !== "light") return;
    setThemeModeState(mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);

  const cycleThemeMode = useCallback(() => {
    setThemeModeState((prev) => {
      let next = "dark";
      if (prev === "system") next = "dark";
      else if (prev === "dark") next = "light";
      else if (prev === "light") next = "system";

      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        themeMode,
        effectiveTheme,
        setThemeMode,
        cycleThemeMode,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
