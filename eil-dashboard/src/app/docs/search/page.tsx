import type { Metadata } from "next";
import DocsSearchClient from "@/components/docs/DocsSearchClient";
import { MarketingShell } from "@/components/marketing/MarketingLayout";

export const metadata: Metadata = {
  title: "Search Papertrend Docs",
  description:
    "Search Papertrend documentation for uploads, dashboards, chat, deep research, queue troubleshooting, and evaluation guidance.",
};

export default function DocsSearchPage() {
  return (
    <MarketingShell activeSlug="docs">
      <DocsSearchClient />
    </MarketingShell>
  );
}
