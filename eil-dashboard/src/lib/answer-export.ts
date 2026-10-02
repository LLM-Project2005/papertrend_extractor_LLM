/*
 * Chat answers and whole conversations as Markdown (docs/32, 4.2): the text as
 * written, with its citations numbered and a source list at the end - papers
 * by title and year, web pages with their address - so it still reads
 * correctly outside the app.
 */
import { citationPaperId, markCitations } from "@/lib/answer-citations";

export interface ExportCitation {
  paperId: string | number;
  title: string;
  year: string;
  href: string;
  sourceType?: "paper" | "web";
}

export interface ExportMessage {
  role: "user" | "assistant" | "system";
  kind?: string | null;
  content: string;
  citations: ExportCitation[];
  metadata?: Record<string, unknown> | null;
}

interface NumberedSource {
  number: number;
  title: string;
  year: string;
  href: string;
  web: boolean;
}

function isWeb(citation: ExportCitation | undefined, href: string): boolean {
  return citation?.sourceType === "web" || /^https?:\/\//i.test(href);
}

function sourceLine(source: NumberedSource): string {
  return source.web
    ? `${source.number}. ${source.title}. ${source.href}`
    : `${source.number}. ${source.title}${source.year && source.year !== "Unknown" ? ` (${source.year})` : ""}.`;
}

/**
 * One answer's text with its citations as [n] against `sources`, which is
 * shared across a conversation: a source cited again keeps its first number.
 */
function numberAnswer(content: string, citations: ExportCitation[], sources: Map<string, NumberedSource>): string {
  const byId = new Map(citations.map((citation) => [citationPaperId(citation), citation]));
  const marked = markCitations(
    content,
    citations.map((citation) => ({ paperId: citationPaperId(citation), title: citation.title, year: citation.year, href: citation.href }))
  );
  const renumber = new Map<number, number>();
  for (const source of marked.sources) {
    const web = isWeb(byId.get(source.paperId), source.href);
    const key = web ? `web:${source.href}` : `paper:${source.paperId}`;
    let entry = sources.get(key);
    if (!entry) {
      entry = { number: sources.size + 1, title: source.title, year: source.year, href: source.href, web };
      sources.set(key, entry);
    }
    renumber.set(source.number, entry.number);
  }
  return marked.text.replace(/\[\[cite:([\d,]+)\]\]/g, (_whole, numbers: string) => {
    const shown = [...new Set(numbers.split(",").map((number) => renumber.get(Number(number)) ?? Number(number)))];
    return `[${shown.join(", ")}]`;
  });
}

function sourcesSection(sources: Map<string, NumberedSource>): string {
  if (sources.size === 0) return "";
  return `\n\n## Sources\n\n${[...sources.values()].map(sourceLine).join("\n")}\n`;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

/** What the app shows under an answer as its caveats, kept with the exported text. */
function limitationsOf(metadata: ExportMessage["metadata"]): string[] {
  return stringList(metadata?.repositoryLimitations).map((item) => item.trim());
}

function chartTitlesOf(metadata: ExportMessage["metadata"]): string[] {
  const charts = Array.isArray(metadata?.charts) ? metadata.charts : metadata?.chart ? [metadata.chart] : [];
  return charts
    .map((chart) => (chart && typeof chart === "object" ? String((chart as { title?: unknown }).title ?? "").trim() : ""))
    .filter(Boolean);
}

function attachmentNamesOf(metadata: ExportMessage["metadata"]): string[] {
  const attachments = Array.isArray(metadata?.attachments) ? metadata.attachments : [];
  return attachments
    .map((attachment) => (attachment && typeof attachment === "object" ? String((attachment as { name?: unknown }).name ?? "").trim() : ""))
    .filter(Boolean);
}

function caveats(metadata: ExportMessage["metadata"]): string {
  const lines: string[] = [];
  for (const title of chartTitlesOf(metadata)) lines.push(`_Chart in the app: ${title}_`);
  const limitations = limitationsOf(metadata);
  if (limitations.length) lines.push(`**Limitations:**\n\n${limitations.map((item) => `- ${item}`).join("\n")}`);
  return lines.length ? `\n\n${lines.join("\n\n")}` : "";
}

/** A single answer (or report), with its own numbered sources and its limitations. */
export function answerMarkdown(content: string, citations: ExportCitation[], metadata?: ExportMessage["metadata"]): string {
  const sources = new Map<string, NumberedSource>();
  const text = numberAnswer(content, citations, sources).trim();
  return `${text}${caveats(metadata)}${sourcesSection(sources)}`.trimEnd() + "\n";
}

/**
 * Whether an assistant message is a finished answer, worth copying or
 * exporting: not a status line, a research plan, or a background answer still
 * being written ("Analyzing ... in the background", found by the pilot smoke
 * check on 2026-10-02 with Copy and Download under it).
 */
export function isFinishedAnswer(message: Pick<ExportMessage, "kind" | "content" | "metadata">): boolean {
  if (message.kind === "status" || message.kind === "deep_research_plan") return false;
  const job = message.metadata?.repositoryJobStatus;
  if (job === "queued" || job === "processing") return false;
  return Boolean(message.content.trim());
}

const SPEAKER: Record<string, string> = {
  deep_research_report: "Deep research report",
};

/**
 * A whole conversation: each question and answer in order, citations numbered
 * once across the conversation, and one source list at the end.
 */
export function conversationMarkdown(input: { title: string; messages: ExportMessage[]; exportedAt: Date }): string {
  const sources = new Map<string, NumberedSource>();
  const parts: string[] = [];
  for (const message of input.messages) {
    if (message.role === "system") continue;
    if (message.role === "user") {
      if (!message.content.trim()) continue;
      const attached = attachmentNamesOf(message.metadata);
      parts.push(`## You\n\n${message.content.trim()}${attached.length ? `\n\n_Attached: ${attached.join(", ")}_` : ""}`);
      continue;
    }
    if (!isFinishedAnswer(message)) continue;
    const speaker = SPEAKER[message.kind ?? ""] ?? "Papertrend";
    parts.push(`## ${speaker}\n\n${numberAnswer(message.content, message.citations, sources).trim()}${caveats(message.metadata)}`);
  }
  const date = input.exportedAt.toISOString().slice(0, 10);
  const header = `# ${input.title.trim() || "Chat"}\n\nExported from Papertrend on ${date}.`;
  return `${header}\n\n${parts.join("\n\n")}${sourcesSection(sources)}`.trimEnd() + "\n";
}

/** A file name from a title: letters, their marks and digits in any script (Thai vowels and tones are marks), hyphens between. */
export function markdownFileName(title: string, fallback = "papertrend-chat"): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return `${slug || fallback}.md`;
}
