"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

type Theme = "light" | "dark";

/** What the reader chose. "system" follows the operating system, live. */
export type ThemePreference = Theme | "system";

interface ThemeContextValue {
  /** The theme on screen now. */
  theme: Theme;
  preference: ThemePreference;
  hydrated: boolean;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
  setPreference: (preference: ThemePreference) => void;
}

// The pre-paint script in app/layout.tsx reads this key; with no key it follows
// the system, which is exactly what the "system" preference stores.
const STORAGE_KEY = "papertrend_theme";
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function readPreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    return saved === "dark" || saved === "light" ? saved : "system";
  } catch {
    return "system";
  }
}

function writePreference(preference: ThemePreference) {
  try {
    if (preference === "system") window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // A preference that cannot be stored still applies for this visit.
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved = readPreference();
    const nextTheme = saved === "system" ? systemTheme() : saved;
    setPreferenceState(saved);
    setThemeState(nextTheme);
    applyTheme(nextTheme);
    setHydrated(true);
  }, []);

  // Following the system means following it when it changes, too.
  useEffect(() => {
    if (preference !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const next = query.matches ? "dark" : "light";
      setThemeState(next);
      applyTheme(next);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [preference]);

  const value = useMemo<ThemeContextValue>(() => {
    const setPreference = (next: ThemePreference) => {
      const resolved = next === "system" ? systemTheme() : next;
      setPreferenceState(next);
      setThemeState(resolved);
      applyTheme(resolved);
      writePreference(next);
    };
    return {
      theme,
      preference,
      hydrated,
      toggleTheme: () => setPreference(theme === "dark" ? "light" : "dark"),
      setTheme: (nextTheme) => setPreference(nextTheme),
      setPreference,
    };
  }, [hydrated, preference, theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider.");
  }

  return context;
}
