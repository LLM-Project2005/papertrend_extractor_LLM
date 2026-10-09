import type { Metadata } from "next";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import HowItWorks from "@/components/marketing/pages/HowItWorks";
import { FeatureEnd } from "@/components/marketing/pages/shared";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "How it works",
  description:
    "Behind the scenes of Papertrend: how each paper is read into topics you can trace to its sentences, and how research chat plans, searches, writes and checks an answer.",
  alternates: {
    canonical: "/how-it-works",
  },
};

export default function HowItWorksPage() {
  return (
    <MarketingShell activeSlug="how-it-works">
      <HowItWorks />
      <FeatureEnd
        title="Follow your own papers through it."
        copy="Make a repository, add a few PDFs, and open any topic or answer at the sentence it came from."
      />
    </MarketingShell>
  );
}
