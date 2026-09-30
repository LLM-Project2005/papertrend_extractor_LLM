import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsArticle } from "@/components/docs/DocsFrame";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import { docsPages, getDocsPage } from "@/lib/docs-content";

// Unknown slugs reach the page and get notFound(). `dynamicParams = false` made
// Next log each one as a server error (NoFallbackError), which is alert noise.

export function generateStaticParams() {
  return docsPages.map((page) => ({
    slug: page.slug,
  }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const page = getDocsPage((await params).slug);

  if (!page) {
    return {
      title: "Docs",
    };
  }

  return {
    title: `${page.title} | Docs`,
    description: page.description,
    alternates: {
      canonical: `/docs/${page.slug}`,
    },
  };
}

export default async function DocsArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const page = getDocsPage((await params).slug);

  if (!page) {
    notFound();
  }

  return (
    <MarketingShell activeSlug="docs">
      <DocsArticle page={page} />
    </MarketingShell>
  );
}
