import type { Metadata } from "next";
import LegalArticle from "@/components/marketing/LegalArticle";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import { termsOfService } from "@/lib/legal-content";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: `${termsOfService.title} | Papertrend`,
  description: termsOfService.description,
  alternates: { canonical: "/terms" },
};

export default function TermsOfServicePage() {
  return (
    <MarketingShell>
      <LegalArticle document={termsOfService} />
    </MarketingShell>
  );
}
