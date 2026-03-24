import type { Metadata } from "next";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { WorkspaceProvider } from "@/components/workspace/WorkspaceProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Papertrend Workspace",
  description:
    "Landing, onboarding, analytics, chat, and import tooling for reusable research-paper workspaces",
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
