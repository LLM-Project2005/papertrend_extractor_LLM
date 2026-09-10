import type { Metadata, Viewport } from "next";
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
  title: "Papertrend Workspace",
  description:
    "Landing, onboarding, analytics, chat, and import tooling for reusable research-paper workspaces",
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
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
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
