import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";
import "@xyflow/react/dist/style.css";
import "./globals.css";

const metadataBase = new URL(
  process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000"
);

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: "Papertrend",
    template: "%s | Papertrend",
  },
  description:
    "Turn a folder of research papers into topics, trends and cited answers you can check.",
  icons: {
    icon: [{ url: "/brand/papertrend-mark.svg", type: "image/svg+xml" }],
    shortcut: "/brand/papertrend-mark.svg",
    apple: "/brand/papertrend-mark.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The browser's own chrome (the mobile address bar) matches the canvas.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

/**
 * Chooses the theme before the first paint.
 *
 * ThemeProvider cannot do this. It starts at "light" and corrects inside an
 * effect, which runs after the browser has already painted - so a reader who
 * asked for dark got 165ms of white, and then, because `body` transitions its
 * background colour, a further 220ms of animated wipe from white to black. On
 * every navigation.
 *
 * This runs synchronously in <head>, so the first frame is already right and
 * the transition has nothing to animate. It reads the same key the provider
 * writes, and falls back to the system preference exactly as the provider does.
 * Wrapped in try/catch because localStorage throws outright in some privacy
 * modes, and a theme preference is never worth a blank page.
 */
const themeScript = `
(function () {
  try {
    var saved = window.localStorage.getItem("papertrend_theme");
    var dark = saved === "dark" || (saved !== "light" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>
            <WorkspaceProvider>{children}</WorkspaceProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
