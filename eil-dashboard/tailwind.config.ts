import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-ui)", "sans-serif"],
        serif: ["var(--font-display)", "serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "6px",
        lg: "8px",
        xl: "8px",
        "2xl": "8px",
        "3xl": "8px",
      },
      colors: {
        papertrend: {
          canvas: "var(--pt-canvas)",
          surface: "var(--pt-surface)",
          raised: "var(--pt-raised)",
          ink: "var(--pt-ink)",
          muted: "var(--pt-muted)",
          line: "var(--pt-line)",
          action: "var(--pt-action)",
          cyan: "var(--pt-cyan)",
          magenta: "var(--pt-magenta)",
        },
        sidebar: {
          bg: "#1e2a3a",
          text: "#d4dce8",
          heading: "#f0f4f8",
          widget: "#243346",
          divider: "#2b4560",
          tag: "#34506e",
          muted: "#b0bfd0",
          alert: "#1e3044",
          "alert-border": "#2b4560",
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
      boxShadow: {
        panel: "0 1px 2px rgba(20, 31, 50, 0.06), 0 10px 28px rgba(20, 31, 50, 0.05)",
        overlay: "0 24px 72px rgba(7, 16, 32, 0.22)",
      },
    },
  },
  plugins: [],
};
export default config;
