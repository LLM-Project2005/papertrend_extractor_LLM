"use client";

import { MoonIcon, SunIcon } from "@/components/ui/Icons";
import { useTheme } from "@/components/theme/ThemeProvider";

export default function ThemeToggle({ compact = false, inverted = false }: { compact?: boolean; inverted?: boolean }) {
  const { theme, hydrated, toggleTheme } = useTheme();
  const isDark = hydrated && theme === "dark";
  const label = isDark ? "Dark" : "Light";

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggleTheme}
        className={`inline-flex h-10 w-10 items-center justify-center rounded-md border transition-colors ${inverted ? "border-white/25 bg-black/25 text-white hover:border-white hover:bg-white hover:text-black" : "border-papertrend-line bg-papertrend-surface text-papertrend-muted hover:border-[var(--pt-line-strong)] hover:text-papertrend-ink"}`}
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
      className="inline-flex items-center gap-2 rounded-md border border-papertrend-line bg-papertrend-surface px-3 py-2 text-sm font-medium text-papertrend-muted transition-colors hover:border-[var(--pt-line-strong)] hover:text-papertrend-ink"
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
