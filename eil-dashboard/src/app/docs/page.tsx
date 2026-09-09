import type { Metadata } from "next";
import { DocsHome } from "@/components/docs/DocsFrame";
import { MarketingShell } from "@/components/marketing/MarketingLayout";

export const metadata: Metadata = {
  title: "Papertrend Docs | Product guides and troubleshooting",
  description:
    "Learn Papertrend workspaces, uploads, paper analysis, dashboards, AI chat, deep research, cloud queue behavior, evaluation, and troubleshooting.",
  alternates: {
    canonical: "/docs",
  },
};

export default function DocsPage() {
  return (
    <MarketingShell activeSlug="docs">
      <DocsHome />
    </MarketingShell>
  );
}
