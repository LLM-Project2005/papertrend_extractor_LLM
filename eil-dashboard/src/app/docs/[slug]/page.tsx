import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DocsArticle } from "@/components/docs/DocsFrame";
import { MarketingShell } from "@/components/marketing/MarketingLayout";
import { docsPages, getDocsPage } from "@/lib/docs-content";

export const dynamicParams = false;

export function generateStaticParams() {
  return docsPages.map((page) => ({
    slug: page.slug,
  }));
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const page = getDocsPage(params.slug);

  if (!page) {
    return {
      title: "Papertrend Docs",
    };
  }

  return {
    title: `${page.title} | Papertrend Docs`,
    description: page.description,
  };
}

export default function DocsArticlePage({
  params,
}: {
  params: { slug: string };
}) {
  const page = getDocsPage(params.slug);

  if (!page) {
    notFound();
  }

  return (
    <MarketingShell activeSlug="docs">
      <DocsArticle page={page} />
    </MarketingShell>
  );
}
