import type { Metadata } from "next";
import LegalArticle from "@/components/marketing/LegalArticle";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import { privacyPolicy } from "@/lib/legal-content";

export const dynamic = "force-static";

export const metadata: Metadata = {
  // The layout's template adds "| Papertrend"; it was in the tab twice.
  title: privacyPolicy.title,
  description: privacyPolicy.description,
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPolicyPage() {
  return (
    <MarketingShell>
      <LegalArticle document={privacyPolicy} />
    </MarketingShell>
  );
}
