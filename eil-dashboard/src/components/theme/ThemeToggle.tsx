"use client";

import { MoonIcon, SunIcon } from "@/components/ui/Icons";
import { useTheme } from "@/components/theme/ThemeProvider";

export default function ThemeToggle() {
  const { theme, hydrated, toggleTheme } = useTheme();
  const isDark = hydrated && theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:text-white"
      aria-label="Toggle theme"
    >
      {isDark ? (
        <MoonIcon className="h-4 w-4" />
      ) : (
        <SunIcon className="h-4 w-4" />
      )}
      <span>{isDark ? "Dark" : "Light"}</span>
    </button>
  );
}
