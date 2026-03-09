import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
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
    },
  },
  plugins: [],
};
export default config;
