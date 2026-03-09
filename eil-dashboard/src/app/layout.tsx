import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "EIL Research Trend Dashboard",
  description:
    "Visualises outputs from the LLM-based extraction pipeline — English as an International Language, Chulalongkorn University",
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
