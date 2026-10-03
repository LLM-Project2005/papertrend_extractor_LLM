/*
 * src/components/theme/ThemeProvider.tsx for render tests. The real provider
 * reads the reader's theme after mounting, which a server render never does;
 * here the theme on screen is globalThis.__auditfixTheme, already hydrated.
 */
import type { ReactNode } from "react";

export type ThemePreference = "light" | "dark" | "system";

declare global {
  // eslint-disable-next-line no-var
  var __auditfixTheme: "light" | "dark" | undefined;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useTheme() {
  const theme = globalThis.__auditfixTheme ?? "light";
  return {
    theme,
    preference: theme as ThemePreference,
    hydrated: true,
    toggleTheme: () => undefined,
    setTheme: () => undefined,
    setPreference: () => undefined,
  };
}
