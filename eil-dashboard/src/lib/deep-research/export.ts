/*
 * A finished report as a Markdown file. The same export as every chat answer
 * (src/lib/answer-export.ts): the report as written, its citations numbered,
 * and a source list at the end.
 */
import { answerMarkdown, markdownFileName, type ExportCitation } from "@/lib/answer-export";

export type { ExportCitation };

export function reportMarkdown(report: string, citations: ExportCitation[]): string {
  return answerMarkdown(report, citations);
}

export function reportFileName(title: string): string {
  return markdownFileName(title, "deep-research-report");
}
