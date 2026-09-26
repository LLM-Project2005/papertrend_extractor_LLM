import type { DocsSection } from "./types";

/** A docs string with its marks removed, for search and reading time. */
export function plainDocsText(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1");
}

/** Every string a section shows, in reading order and without marks. */
export function sectionPlainText(section: DocsSection): string[] {
  return [
    ...section.body,
    ...(section.steps ?? []),
    ...(section.bullets ?? []),
    ...(section.table?.columns ?? []),
    ...(section.table?.rows.flat() ?? []),
    ...(section.definitions ?? []).map((item) => `${item.term} ${item.detail}`),
    ...(section.subsections ?? []).flatMap((sub) => [sub.title, ...sub.body, ...(sub.bullets ?? [])]),
    ...(section.checklist ?? []),
    ...(section.callout ? [section.callout.title, section.callout.body] : []),
  ].map(plainDocsText);
}
