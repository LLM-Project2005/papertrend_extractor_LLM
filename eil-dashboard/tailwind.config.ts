import type { Config } from "tailwindcss";
import { GRAY } from "./src/lib/palette";

/*
 * Semantic colours read CSS variables that globals.css defines once per theme,
 * so `bg-surface text-ink border-hairline` is right in light and dark without a
 * `dark:` twin. They are channel triplets so opacity modifiers still work
 * (`bg-ink/5`).
 */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/lib/**/*.{js,ts}",
  ],
  theme: {
    extend: {
      colors: {
        // The whole app's grays. See src/lib/palette.ts for why slate is remapped.
        slate: GRAY,
        canvas: token("canvas"),
        surface: token("surface"),
        subtle: token("subtle"),
        hairline: token("hairline"),
        "hairline-strong": token("hairline-strong"),
        ink: token("ink"),
        body: token("body"),
        mute: token("mute"),
        accent: token("accent"),
        "accent-soft": token("accent-soft"),
        "accent-ink": token("accent-ink"),
        sidebar: {
          bg: "#050505",
          text: "#d4d4d4",
          heading: "#f5f5f5",
          widget: "#0a0a0a",
          divider: "#242424",
          tag: "#171717",
          muted: "#a3a3a3",
          alert: "#0a0a0a",
          "alert-border": "#2a2a2a",
        },
        card: {
          bg: "#f8f9fb",
          border: "#dde1e8",
        },
        track: {
          el: "#4a7fe5",
          eli: "#e05c5c",
          lae: "#3cba83",
          other: "#9b7fd4",
        },
      },
      fontFamily: {
        // Geist carries no Thai; each platform's own Thai face takes over for
        // those characters instead of a generic fallback.
        sans: [
          "var(--font-geist-sans)",
          "Noto Sans Thai",
          "Leelawadee UI",
          "Thonburi",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SFMono-Regular", "Menlo", "Consolas", "monospace"],
      },
      boxShadow: {
        // Stacked, offset layers rather than one blur; each theme sets its own.
        raise: "var(--shadow-raise)",
        float: "var(--shadow-float)",
        overlay: "var(--shadow-overlay)",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        "out-quart": "cubic-bezier(0.25, 1, 0.5, 1)",
      },
      transitionDuration: {
        "120": "120ms",
        "250": "250ms",
        "400": "400ms",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          from: { opacity: "0", transform: "translateY(4px) scale(0.98)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
        "progress-sweep": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(250%)" },
        },
        "drawer-in": {
          from: { transform: "translateX(-100%)" },
          to: { transform: "translateX(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 200ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "rise-in": "rise-in 320ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "scale-in": "scale-in 240ms cubic-bezier(0.16, 1, 0.3, 1) both",
        shimmer: "shimmer 1.6s linear infinite",
        "progress-sweep": "progress-sweep 1.4s cubic-bezier(0.45, 0, 0.55, 1) infinite",
        "drawer-in": "drawer-in 280ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
export default config;
