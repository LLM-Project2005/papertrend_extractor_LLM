import type { DocsCategoryBase, DocsPageBase } from "@/lib/docs/types";
import { plainDocsText, sectionPlainText } from "@/lib/docs/plain-text";
import { startCategory } from "@/lib/docs/start";
import { readingAPaperPage, uploadingPapersPage } from "@/lib/docs/papers-upload";
import { analysisPipelinePage, analysisProfilesPage } from "@/lib/docs/papers-analysis";
import { exploreCategory } from "@/lib/docs/explore";
import { accountCategory } from "@/lib/docs/account";
import { helpCategory } from "@/lib/docs/help";

/*
 * The documentation, assembled from one module per category in src/lib/docs.
 * Every statement in those pages was checked against the code; when the
 * product changes, change the page that describes it in the same commit.
 */

export type {
  DocsCallout,
  DocsCalloutTone,
  DocsDefinition,
  DocsFigure,
  DocsSection,
  DocsSubsection,
  DocsTable,
} from "@/lib/docs/types";

export interface DocsPage extends DocsPageBase {
  categoryId: string;
  categoryLabel: string;
}

export interface DocsCategory {
  id: string;
  label: string;
  description: string;
  pages: DocsPage[];
}

export interface DocsSearchItem {
  id: string;
  title: string;
  description: string;
  href: string;
  category: string;
  tags: string[];
  searchText: string;
  pageSlug: string;
  sectionId?: string;
}

const papersCategory: DocsCategoryBase = {
  id: "papers",
  label: "Papers and analysis",
  description: "Adding papers, what the analysis reads and finds, and sorting papers into categories.",
  pages: [uploadingPapersPage, analysisPipelinePage, readingAPaperPage, analysisProfilesPage],
};

const rawDocsCategories: DocsCategoryBase[] = [
  startCategory,
  papersCategory,
  exploreCategory,
  accountCategory,
  helpCategory,
];

export const docsCategories: DocsCategory[] = rawDocsCategories.map((category) => ({
  ...category,
  pages: category.pages.map((page) => ({
    ...page,
    categoryId: category.id,
    categoryLabel: category.label,
  })),
}));

export const docsPages: DocsPage[] = docsCategories.flatMap((category) => category.pages);

export const popularDocsPages = docsPages.filter((page) => page.popular);

export function getDocsPage(slug: string) {
  return docsPages.find((page) => page.slug === slug) ?? null;
}

export function getRelatedDocs(page: DocsPage) {
  return (page.related ?? [])
    .map((slug) => getDocsPage(slug))
    .filter((related): related is DocsPage => Boolean(related));
}

export const docsSearchItems: DocsSearchItem[] = docsPages.flatMap((page) => {
  const description = plainDocsText(page.description);
  const pageText = [
    page.title,
    description,
    page.categoryLabel,
    page.tags.join(" "),
    ...page.sections.flatMap((section) => [section.title, ...sectionPlainText(section)]),
  ].join(" ");

  return [
    {
      id: `page:${page.slug}`,
      title: page.title,
      description,
      href: `/docs/${page.slug}`,
      category: page.categoryLabel,
      tags: page.tags,
      searchText: pageText,
      pageSlug: page.slug,
    },
    ...page.sections.map((section) => ({
      id: `section:${page.slug}:${section.id}`,
      title: section.title,
      description: page.title,
      href: `/docs/${page.slug}#${section.id}`,
      category: page.categoryLabel,
      tags: page.tags,
      searchText: [page.title, section.title, ...sectionPlainText(section)].join(" "),
      pageSlug: page.slug,
      sectionId: section.id,
    })),
  ];
});

export const docsSuggestedQueries = [
  "upload paper",
  "failed paper",
  "unknown year",
  "themes",
  "chat scope",
  "deep research",
  "reclassify",
  "daily limit",
];
