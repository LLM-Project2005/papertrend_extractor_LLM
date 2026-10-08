import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ComponentType } from "react";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import { marketingFeatures, type FeatureSlug } from "@/components/marketing/marketing-content";
import AnalysisFeature from "@/components/marketing/pages/AnalysisFeature";
import ChatFeature from "@/components/marketing/pages/ChatFeature";
import DashboardFeature from "@/components/marketing/pages/DashboardFeature";
import UploadsFeature from "@/components/marketing/pages/UploadsFeature";
import { FeatureEnd } from "@/components/marketing/pages/shared";

interface FeaturePageProps {
  params: Promise<{
    slug: string;
  }>;
}

// Unknown slugs reach the page and get notFound(). `dynamicParams = false` made
// Next log each one as a server error (NoFallbackError), which is alert noise.
export const dynamic = "force-static";

/*
 * Each feature has a page of its own shape. They share the site's type, colour
 * and motion, but not a template: a pipeline is told as a graph, a dashboard
 * as its views, a chat as what happens to a question, an upload as the route
 * a file takes.
 */
const PAGES: Record<FeatureSlug, { Body: ComponentType; end: { title: string; copy: string } }> = {
  "paper-analysis": {
    Body: AnalysisFeature,
    end: {
      title: "Give it the papers on your desk.",
      copy: "Make a repository, add a few PDFs, and see what each one says, with the line it says it in.",
    },
  },
  "research-dashboard": {
    Body: DashboardFeature,
    end: {
      title: "See where your field is going.",
      copy: "Add the papers you are reading and the dashboard draws itself from them, with the papers one click behind every number.",
    },
  },
  "ai-research-chat": {
    Body: ChatFeature,
    end: {
      title: "Ask the question you have been putting off.",
      copy: "Upload the papers, ask in English or Thai, and open the source of every claim.",
    },
  },
  "cloud-queue": {
    Body: UploadsFeature,
    end: {
      title: "Start with a folder.",
      copy: "Drop in the PDFs you have, close the tab, and come back to a repository that has been read.",
    },
  },
};

function findFeature(slug: string) {
  return marketingFeatures.find((feature) => feature.slug === slug);
}

export function generateStaticParams() {
  return marketingFeatures.map((feature) => ({
    slug: feature.slug,
  }));
}

export async function generateMetadata({ params }: FeaturePageProps): Promise<Metadata> {
  const feature = findFeature((await params).slug);

  if (!feature) {
    return {
      title: "Features",
    };
  }

  return {
    title: feature.navLabel,
    description: feature.description,
    alternates: {
      canonical: `/features/${feature.slug}`,
    },
  };
}

export default async function FeaturePage({ params }: FeaturePageProps) {
  const feature = findFeature((await params).slug);
  if (!feature) {
    notFound();
  }
  const { Body, end } = PAGES[feature.slug];

  return (
    <MarketingShell activeSlug={feature.slug}>
      <Body />
      <FeatureEnd slug={feature.slug} title={end.title} copy={end.copy} />
    </MarketingShell>
  );
}
