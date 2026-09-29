/*
 * A finished report as a Markdown file: the report as written, with its
 * citations numbered and a source list at the end - papers by title and year,
 * web pages with their address - so it still reads correctly outside the app.
 */
import { markCitations } from "@/lib/answer-citations";

export interface ExportCitation {
  paperId: string | number;
  title: string;
  year: string;
  href: string;
  sourceType?: "paper" | "web";
}

export function reportMarkdown(report: string, citations: ExportCitation[]): string {
  const marked = markCitations(
    report,
    citations.map((citation) => ({ paperId: String(citation.paperId), title: citation.title, year: citation.year, href: citation.href }))
  );
  const text = marked.text.replace(/\[\[cite:([\d,]+)\]\]/g, (_whole, numbers: string) => `[${numbers.split(",").join(", ")}]`);
  if (marked.sources.length === 0) return `${text.trim()}\n`;
  const byId = new Map(citations.map((citation) => [String(citation.paperId), citation]));
  const sources = marked.sources.map((source) => {
    const citation = byId.get(source.paperId);
    const web = citation?.sourceType === "web" || /^https?:\/\//i.test(source.href);
    return web
      ? `${source.number}. ${source.title}. ${source.href}`
      : `${source.number}. ${source.title}${source.year && source.year !== "Unknown" ? ` (${source.year})` : ""}.`;
  });
  return `${text.trim()}\n\n## Sources\n\n${sources.join("\n")}\n`;
}

export function reportFileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "deep-research-report"}.md`;
}
