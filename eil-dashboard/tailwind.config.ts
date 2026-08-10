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
      colors: {
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
    },
  },
  plugins: [],
};
export default config;
