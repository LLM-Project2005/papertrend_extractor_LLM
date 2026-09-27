export type DocsCalloutTone = "info" | "success" | "warning";

export interface DocsCallout {
  tone: DocsCalloutTone;
  title: string;
  body: string;
}

/** A table of facts: limits, messages, what each option does. */
export interface DocsTable {
  caption?: string;
  columns: string[];
  rows: string[][];
}

/** A real screenshot from public/marketing (see shot-manifest.ts). */
export interface DocsFigure {
  shot: string;
  alt: string;
  caption?: string;
}

export interface DocsDefinition {
  term: string;
  detail: string;
}

export interface DocsSubsection {
  title: string;
  body: string[];
  bullets?: string[];
}

/**
 * One section of a page. Text fields accept three inline marks, rendered by
 * DocsText: **bold** for a UI label, `code` for exact text, [label](/path) for
 * a link. The blocks render in the order they are declared here.
 */
export interface DocsSection {
  id: string;
  title: string;
  body: string[];
  figure?: DocsFigure;
  steps?: string[];
  bullets?: string[];
  table?: DocsTable;
  definitions?: DocsDefinition[];
  subsections?: DocsSubsection[];
  checklist?: string[];
  callout?: DocsCallout;
}

export interface DocsPageBase {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  /** A short list for the docs home. Keep it to about a third of the pages. */
  popular?: boolean;
  sections: DocsSection[];
  related?: string[];
}

export interface DocsCategoryBase {
  id: string;
  label: string;
  description: string;
  pages: DocsPageBase[];
}
