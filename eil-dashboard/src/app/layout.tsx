import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EIL Research Dashboard",
  description:
    "Dashboard, chat, and import tooling for the EIL paper-analysis pipeline at Chulalongkorn University",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
