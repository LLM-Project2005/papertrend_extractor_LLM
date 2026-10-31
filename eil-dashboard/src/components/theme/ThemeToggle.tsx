"use client";

import { MoonIcon, SunIcon } from "@/components/ui/Icons";
import { useTheme } from "@/components/theme/ThemeProvider";

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, hydrated, toggleTheme } = useTheme();
  const isDark = hydrated && theme === "dark";
  const label = isDark ? "Dark" : "Light";

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-body transition-[background-color,color,transform] duration-150 hover:bg-subtle hover:text-ink active:scale-95"
        aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
        title={label}
      >
        {isDark ? (
          <MoonIcon className="h-4 w-4" />
        ) : (
          <SunIcon className="h-4 w-4" />
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="inline-flex items-center gap-2 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-slate-300 hover:text-ink dark:hover:border-[#3a3a3a]"
      aria-label="Toggle theme"
    >
      {isDark ? (
        <MoonIcon className="h-4 w-4" />
      ) : (
        <SunIcon className="h-4 w-4" />
      )}
      <span>{label}</span>
    </button>
  );
}
