"use client";

/**
 * How an assistant answer is drawn.
 *
 * Extracted from ChatClient so it can be rendered in a test. It previously sat
 * inside a 4,500-line component, so the only thing a test could do was match
 * patterns in the source - which proves the code was written, not that React
 * produces the elements a reader needs.
 */
// The default import is what lets this module render under the classic JSX
// transform the test runner uses; Next compiles it away.
import React, { useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  foldPoint,
  markCitations,
  type CitationSource,
} from "@/lib/answer-citations";
import {
  ANSWER_BODY_CLASS,
  ANSWER_CELL_CLASS,
  ANSWER_MEASURE_CLASS,
  ANSWER_META_CLASS,
} from "@/lib/answer-typography";

export interface AnswerCitation {
  paperId: number | string;
  title: string;
  year: string;
  href: string;
  reason?: string;
  sourceType?: "paper" | "web";
}

/**
 * One numbered citation, with the source it points at on hover or focus.
 *
 * A 60-character paper title inside a sentence is an interruption, and a
 * paragraph making three claims carried three of them. The marker keeps the
 * sentence readable while the source stays one pointer away, and the same card
 * opens on keyboard focus so it is not mouse-only.
 */
export function CitationMarker({ numbers, sources }: { numbers: number[]; sources: CitationSource[] }) {
  const referenced = numbers
    .map((number) => sources.find((source) => source.number === number))
    .filter((source): source is CitationSource => Boolean(source));
  if (referenced.length === 0) return null;
  const label = referenced
    .map((source) => `${source.title}${source.year && source.year !== "Unknown" ? ` (${source.year})` : ""}`)
    .join("; ");

  return (
    <span className="group relative inline-block align-baseline">
      <button
        type="button"
        aria-label={`Source: ${label}`}
        className="ml-0.5 cursor-help rounded align-super text-[0.68em] font-semibold text-sky-700 underline decoration-dotted underline-offset-2 transition-colors hover:text-sky-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-sky-300 dark:hover:text-sky-200"
      >
        {numbers.join(",")}
      </button>
      <span
        role="tooltip"
        className={`pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 hidden w-72 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-3 text-left ${ANSWER_META_CLASS} text-slate-700 shadow-lg group-focus-within:block group-hover:block dark:border-[#2a2a2a] dark:bg-[#121212] dark:text-[#d4d4d4]`}
      >
        {referenced.map((source) => (
          <span key={source.paperId} className="block [&+&]:mt-2 [&+&]:border-t [&+&]:border-slate-200 [&+&]:pt-2 dark:[&+&]:border-[#2a2a2a]">
            <span className="block font-semibold text-slate-900 dark:text-white">{source.title}</span>
            <span className="block text-slate-600 dark:text-[#8e8e8e]">
              {source.year && source.year !== "Unknown" ? source.year : "Year not recorded"}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}

export function renderInlineMarkdown(
  text: string,
  keyPrefix: string,
  sources: CitationSource[] = []
): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Ordered so the longer opener wins: ** before *, ~~ before ~.
  const pattern =
    /(\[\[cite:[\d,]+\]\]|\*\*[^*]+\*\*|~~[^~]+~~|(?<![*\w])\*[^*\n]+\*(?!\*)|(?<![_\w])_[^_\n]+_(?![_\w])|`[^`]+`|\[[^\]]+\]\((https?:\/\/[^)\s]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith("[[cite:")) {
      const numbers = token
        .slice(7, -2)
        .split(",")
        .map((part) => Number.parseInt(part, 10))
        .filter((value) => Number.isFinite(value));
      nodes.push(
        <CitationMarker key={`${keyPrefix}-cite-${match.index}`} numbers={numbers} sources={sources} />
      );
    } else if (token.startsWith("~~") && token.endsWith("~~")) {
      nodes.push(
        <s key={`${keyPrefix}-strike-${match.index}`} className="opacity-70">
          {token.slice(2, -2)}
        </s>
      );
    } else if (
      (token.startsWith("*") && !token.startsWith("**")) ||
      (token.startsWith("_") && !token.startsWith("__"))
    ) {
      nodes.push(
        <em key={`${keyPrefix}-em-${match.index}`} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={`${keyPrefix}-strong-${match.index}`} className="font-semibold text-slate-900 dark:text-white">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("[") && token.includes("](") && token.endsWith(")")) {
      const parts = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
      if (parts) {
        nodes.push(
          <a
            key={`${keyPrefix}-link-${match.index}`}
            href={parts[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-sky-700 underline underline-offset-4 transition-colors hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-200"
          >
            {parts[1]}
          </a>
        );
      } else {
        nodes.push(token);
      }
    } else if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`${keyPrefix}-code-${match.index}`}
          className="rounded bg-slate-200 px-1.5 py-0.5 font-mono text-[0.95em] text-slate-800 dark:bg-white/10 dark:text-[#f3f3f3]"
        >
          {token.slice(1, -1)}
        </code>
      );
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function isMarkdownTable(lines: string[]) {
  if (lines.length < 2) {
    return false;
  }
  const separator = lines[1].trim();
  return (
    lines[0].includes("|") &&
    /^\|?[\s:-]+(\|[\s:-]+)+\|?$/.test(separator)
  );
}

function parseMarkdownTableRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function groupMarkdownLines(lines: string[]) {
  const groups: string[][] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (/^#{1,6}\s+/.test(line)) {
      groups.push([line]);
      index += 1;
      continue;
    }

    if (line.includes("|") && index + 1 < lines.length) {
      const tableCandidate = [line, lines[index + 1]];
      let cursor = index + 2;
      while (cursor < lines.length && lines[cursor].includes("|")) {
        tableCandidate.push(lines[cursor]);
        cursor += 1;
      }
      if (isMarkdownTable(tableCandidate)) {
        groups.push(tableCandidate);
        index = cursor;
        continue;
      }
    }

    if (/^[-*]\s+/.test(line)) {
      const listGroup = [line];
      index += 1;
      while (index < lines.length && /^[-*]\s+/.test(lines[index])) {
        listGroup.push(lines[index]);
        index += 1;
      }
      groups.push(listGroup);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const listGroup = [line];
      index += 1;
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        listGroup.push(lines[index]);
        index += 1;
      }
      groups.push(listGroup);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteGroup = [line];
      index += 1;
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteGroup.push(lines[index]);
        index += 1;
      }
      groups.push(quoteGroup);
      continue;
    }

    const paragraphGroup = [line];
    index += 1;
    while (
      index < lines.length &&
      !/^#{1,6}\s+/.test(lines[index]) &&
      !/^[-*]\s+/.test(lines[index]) &&
      !/^\d+\.\s+/.test(lines[index]) &&
      !/^>\s?/.test(lines[index])
    ) {
      if (lines[index].includes("|") && index + 1 < lines.length) {
        const candidate = [lines[index], lines[index + 1]];
        if (isMarkdownTable(candidate)) {
          break;
        }
      }
      paragraphGroup.push(lines[index]);
      index += 1;
    }
    groups.push(paragraphGroup);
  }

  return groups;
}

export function renderRichMessage(
  content: string,
  keyPrefix: string,
  tone: "assistant" | "user" = "assistant",
  sources: CitationSource[] = []
) {
  const normalized = content.replace(/\r\n/g, "\n");
  const blocks: string[] = [];
  const lines = normalized.split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const codeLines = [line];
      index += 1;
      while (index < lines.length) {
        codeLines.push(lines[index]);
        if (lines[index].trim().startsWith("```")) {
          index += 1;
          break;
        }
        index += 1;
      }
      blocks.push(codeLines.join("\n"));
      continue;
    }

    const chunk = [line];
    index += 1;
    while (index < lines.length && lines[index].trim()) {
      if (lines[index].trim().startsWith("```")) {
        break;
      }
      chunk.push(lines[index]);
      index += 1;
    }
    blocks.push(chunk.join("\n"));
  }

  const headingClass =
    tone === "assistant"
      ? "text-lg font-semibold text-slate-900 dark:text-white"
      : "text-base font-semibold text-slate-900 dark:text-[#f3f3f3]";
  const paragraphClass =
    tone === "assistant"
      ? `${ANSWER_BODY_CLASS} ${ANSWER_MEASURE_CLASS} text-slate-700 dark:text-[#ececec]`
      : `${ANSWER_BODY_CLASS} ${ANSWER_MEASURE_CLASS} text-slate-800 dark:text-[#f3f3f3]`;

  return (
    <div className="space-y-4">
      {blocks.map((block, blockIndex) => {
        const rawLines = block.split("\n").map((line) => line.trim()).filter(Boolean);
        if (rawLines.length === 0) {
          return null;
        }

        if (block.trim().startsWith("```")) {
          const rawLines = block.split("\n");
          const fence = rawLines[0].trim();
          const language = fence.replace(/^```/, "").trim();
          const code = rawLines
            .slice(1, rawLines[rawLines.length - 1]?.trim().startsWith("```") ? -1 : undefined)
            .join("\n");
          return (
            <div
              key={`${keyPrefix}-codeblock-${blockIndex}`}
              className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-[#1f1f1f] dark:bg-[#050505]"
            >
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2 text-xs uppercase tracking-normal text-slate-600 dark:border-[#1f1f1f] dark:text-[#8e8e8e]">
                <span>{language || "Code"}</span>
              </div>
              <pre className="overflow-x-auto px-4 py-4 text-sm leading-6 text-slate-700 dark:text-[#e6e6e6]">
                <code>{code}</code>
              </pre>
            </div>
          );
        }

        return (
          <div key={`${keyPrefix}-block-${blockIndex}`} className="space-y-4">
            {groupMarkdownLines(rawLines).map((lines, groupIndex) => {
              if (isMarkdownTable(lines)) {
                const header = parseMarkdownTableRow(lines[0]);
                const rows = lines.slice(2).map(parseMarkdownTableRow).filter((row) => row.length > 0);
                return (
                  <div
                    key={`${keyPrefix}-table-${blockIndex}-${groupIndex}`}
                    className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-[#1f1f1f] dark:bg-[#0a0a0a]"
                  >
                    <table className="min-w-full border-collapse text-left text-sm text-slate-700 dark:text-[#ececec]">
                      <thead className="bg-slate-100 dark:bg-white/5">
                        <tr>
                          {header.map((cell, cellIndex) => (
                            <th
                              key={`${keyPrefix}-th-${blockIndex}-${groupIndex}-${cellIndex}`}
                              className={`border-b border-slate-200 px-4 py-3 font-semibold ${ANSWER_CELL_CLASS} dark:border-[#1f1f1f]`}
                            >
                              {renderInlineMarkdown(cell, `${keyPrefix}-th-${blockIndex}-${groupIndex}-${cellIndex}`, sources)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row, rowIndex) => (
                          <tr key={`${keyPrefix}-tr-${blockIndex}-${groupIndex}-${rowIndex}`} className="border-t border-slate-200 dark:border-[#1f1f1f]">
                            {row.map((cell, cellIndex) => (
                              <td
                                key={`${keyPrefix}-td-${blockIndex}-${groupIndex}-${rowIndex}-${cellIndex}`}
                                className="px-4 py-3 align-top text-slate-600 dark:text-[#d8d8d8]"
                              >
                                {renderInlineMarkdown(cell, `${keyPrefix}-td-${blockIndex}-${groupIndex}-${rowIndex}-${cellIndex}`, sources)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              }

              const bulletLines = lines.filter((line) => /^[-*]\s+/.test(line));
              if (bulletLines.length === lines.length) {
                return (
                  <ul
                    key={`${keyPrefix}-list-${blockIndex}-${groupIndex}`}
                    className={`space-y-2 ${paragraphClass}`}
                  >
                    {bulletLines.map((line, lineIndex) => (
                      <li key={`${keyPrefix}-item-${blockIndex}-${groupIndex}-${lineIndex}`} className="flex gap-3">
                        <span className="mt-2 h-1.5 w-1.5 flex-none rounded-full bg-slate-400 dark:bg-white/60" />
                        <span>{renderInlineMarkdown(line.replace(/^[-*]\s+/, ""), `${keyPrefix}-${blockIndex}-${groupIndex}-${lineIndex}`, sources)}</span>
                      </li>
                    ))}
                  </ul>
                );
              }

              const numberedLines = lines.filter((line) => /^\d+\.\s+/.test(line));
              if (numberedLines.length === lines.length) {
                return (
                  <ol
                    key={`${keyPrefix}-ordered-${blockIndex}-${groupIndex}`}
                    className={`space-y-2 ${paragraphClass}`}
                  >
                    {numberedLines.map((line, lineIndex) => (
                      <li key={`${keyPrefix}-ordered-item-${blockIndex}-${groupIndex}-${lineIndex}`} className="flex gap-3">
                        <span className="min-w-[1.5rem] flex-none font-semibold text-slate-600 dark:text-white/75">
                          {line.match(/^(\d+)\./)?.[1]}.
                        </span>
                        <span>{renderInlineMarkdown(line.replace(/^\d+\.\s+/, ""), `${keyPrefix}-ordered-${blockIndex}-${groupIndex}-${lineIndex}`, sources)}</span>
                      </li>
                    ))}
                  </ol>
                );
              }

              const quoteLines = lines.filter((line) => /^>\s?/.test(line));
              if (quoteLines.length === lines.length) {
                return (
                  <blockquote
                    key={`${keyPrefix}-quote-${blockIndex}-${groupIndex}`}
                    className={`rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 ${ANSWER_BODY_CLASS} text-slate-800 dark:border-[#2a2a2a] dark:bg-[#0a0a0a] dark:text-[#d4d4d4]`}
                  >
                    <div className="space-y-2">
                      {quoteLines.map((line, lineIndex) => (
                        <p key={`${keyPrefix}-quote-line-${blockIndex}-${groupIndex}-${lineIndex}`}>
                          {renderInlineMarkdown(line.replace(/^>\s?/, ""), `${keyPrefix}-quote-${blockIndex}-${groupIndex}-${lineIndex}`, sources)}
                        </p>
                      ))}
                    </div>
                  </blockquote>
                );
              }

              if (lines.length === 1 && /^#{1,6}\s+/.test(lines[0])) {
                const headingMatch = lines[0].match(/^(#{1,6})\s+(.+)$/);
                const headingLevel = headingMatch?.[1].length ?? 3;
                const headingText = headingMatch?.[2] ?? lines[0];
                const headingContent = renderInlineMarkdown(
                  headingText,
                  `${keyPrefix}-heading-${blockIndex}-${groupIndex}`,
                  sources
                );
                const headingKey = `${keyPrefix}-heading-${blockIndex}-${groupIndex}`;
                if (headingLevel === 1) {
                  return <h2 key={headingKey} className={`${headingClass} text-xl`}>{headingContent}</h2>;
                }
                if (headingLevel === 2) {
                  return <h3 key={headingKey} className={headingClass}>{headingContent}</h3>;
                }
                if (headingLevel === 3) {
                  return <h4 key={headingKey} className={`${headingClass} text-base`}>{headingContent}</h4>;
                }
                return (
                  <h5 key={headingKey} className="text-sm font-semibold text-slate-800 dark:text-[#ececec]">
                    {headingContent}
                  </h5>
                );
              }

              return (
                <p key={`${keyPrefix}-paragraph-${blockIndex}-${groupIndex}`} className={paragraphClass}>
                  {renderInlineMarkdown(lines.join(" "), `${keyPrefix}-paragraph-${blockIndex}-${groupIndex}`, sources)}
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One assistant answer: numbered citations, and a fold when it runs long.
 *
 * Measured on the live suite, answers range from 400 to 15,300 characters. The
 * long ones are not padding - a five-paper methodology comparison genuinely has
 * that much to say - but arriving at a wall of text hides the part the reader
 * asked for. The opening stays visible and the rest is one click away, so the
 * direct answer is never behind a fold.
 */
export function AssistantAnswer({
  content,
  messageId,
  citations,
}: {
  content: string;
  messageId: string;
  citations?: AnswerCitation[] | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const { text, sources } = useMemo(
    () =>
      markCitations(
        content,
        (citations ?? [])
          .filter((citation) => citation.paperId)
          .map((citation) => ({
            paperId: String(citation.paperId),
            title: String(citation.title ?? ""),
            year: String(citation.year ?? ""),
            href: String(citation.href ?? ""),
          }))
      ),
    [content, citations]
  );

  const cut = useMemo(() => foldPoint(text), [text]);
  const visible = cut !== null && !expanded ? text.slice(0, cut) : text;
  const hiddenChars = cut !== null && !expanded ? text.length - cut : 0;

  return (
    <div className="space-y-3">
      {renderRichMessage(visible, messageId, "assistant", sources)}
      {cut !== null ? (
        <button
          type="button"
          onClick={() => setExpanded((previous) => !previous)}
          aria-expanded={expanded}
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 dark:border-[#1f1f1f] dark:bg-[#0a0a0a] dark:text-[#b4b4b4] dark:hover:bg-[#121212] dark:hover:text-white"
        >
          {expanded
            ? "Show less"
            : `Show more (${hiddenChars.toLocaleString()} more characters)`}
        </button>
      ) : null}
    </div>
  );
}

