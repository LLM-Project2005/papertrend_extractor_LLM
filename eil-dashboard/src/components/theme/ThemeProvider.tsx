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

interface ThemeContextValue {
  theme: Theme;
  hydrated: boolean;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

const STORAGE_KEY = "papertrend_theme";
const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("light");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? (window.localStorage.getItem(STORAGE_KEY) as Theme | null)
        : null;
    const nextTheme =
      saved === "dark" || saved === "light"
        ? saved
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    setThemeState(nextTheme);
    applyTheme(nextTheme);
    setHydrated(true);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      hydrated,
      toggleTheme: () => {
        setThemeState((current) => {
          const nextTheme = current === "dark" ? "light" : "dark";
          applyTheme(nextTheme);
          window.localStorage.setItem(STORAGE_KEY, nextTheme);
          return nextTheme;
        });
      },
      setTheme: (nextTheme) => {
        setThemeState(nextTheme);
        applyTheme(nextTheme);
        window.localStorage.setItem(STORAGE_KEY, nextTheme);
      },
    }),
    [hydrated, theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider.");
  }

  return context;
}
