import { tokenizeRepositoryText } from "@/lib/repository-text";

/**
 * What the chat renderer can display, and what an answer must avoid.
 *
 * The chat page renders Markdown itself rather than through a library, so it
 * supports a deliberate subset. Anything outside that subset reaches the reader
 * as literal punctuation - *like this* - which looks like a bug and is what the
 * judge means by "leaked markup".
 *
 * The subset is declared here, once, and both the renderer and these checks
 * read it. Without a shared declaration the two drift silently: someone widens
 * the renderer and the checks keep rejecting valid answers, or someone loosens
 * the answer rules and the renderer starts leaking asterisks at readers.
 */

/** Block constructs `renderRichMessage` turns into elements. */
export const SUPPORTED_BLOCKS = [
  "heading",
  "bullet-list",
  "ordered-list",
  "blockquote",
  "fenced-code",
  "table",
  "paragraph",
] as const;

/** Inline constructs `renderInlineMarkdown` turns into elements. */
export const SUPPORTED_INLINE = [
  "bold",
  "italic",
  "strikethrough",
  "inline-code",
  "link",
] as const;

export type RenderingIssueKind =
  | "leaked-json"
  | "unsupported-markdown"
  | "broken-table"
  | "empty-section"
  | "unclosed-code-fence";

export interface RenderingIssue {
  kind: RenderingIssueKind;
  detail: string;
  sample: string;
}

/** Fenced code is verbatim by definition, so it is removed before scanning. */
function withoutCodeBlocks(answer: string): string {
  return answer.replace(/```[\s\S]*?(?:```|$)/g, "\n");
}

function sampleOf(text: string, limit = 60): string {
  return text.replace(/\s+/g, " ").trim().slice(0, limit);
}

/**
 * Markdown the renderer does not implement, which would display literally.
 *
 * Each pattern carries the reason it is unsupported, so a later reader can
 * decide to implement it rather than guess why it was excluded.
 */
const UNSUPPORTED_PATTERNS: Array<{ kind: string; pattern: RegExp }> = [
  // An image cannot be grounded in a paper, so answers must not produce one.
  { kind: "image", pattern: /!\[[^\]]*\]\([^)\s]+\)/g },
  // The renderer draws no horizontal rule; three dashes would show as dashes.
  { kind: "horizontal-rule", pattern: /(?:^|\n)[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*(?=\n|$)/g },
  // Lists are flattened, so an indented sub-item loses its nesting entirely.
  { kind: "nested-list", pattern: /(?:^|\n)[ \t]{2,}[-*+][ \t]+\S/g },
  { kind: "task-list", pattern: /(?:^|\n)[ \t]*[-*][ \t]+\[[ xX]\][ \t]+/g },
  { kind: "footnote-definition", pattern: /(?:^|\n)\[\^[^\]]+\]:/g },
  { kind: "html-tag", pattern: /<\/?[a-zA-Z][a-zA-Z0-9-]*(?:\s[^<>]*)?>/g },
  // Only absolute http(s) links render as links; anything else shows as text.
  { kind: "non-http-link", pattern: /\[[^\]]+\]\((?!https?:\/\/)[^)\s]+\)/g },
  // A heading needs the space after its hashes or it is read as a paragraph.
  { kind: "heading-without-space", pattern: /(?:^|\n)#{1,6}(?=[^#\s])/g },
  // The internal evidence marker must be replaced before an answer is shown.
  { kind: "unreplaced-paper-marker", pattern: /\[Paper\s+[^\]]{1,40}\]/gi },
];

export interface RenderingScanOptions {
  /**
   * True while the answer is still being built, before `[Paper 12]` markers
   * have been turned into readable citations.
   *
   * Every draft carries those markers by design, so checking for them mid
   * pipeline would flag every answer ever written. They are only a defect once
   * the answer is finished and about to be shown.
   */
  beforeCitationFormatting?: boolean;
}

export function unsupportedMarkdown(
  answer: string,
  options: RenderingScanOptions = {}
): RenderingIssue[] {
  const scannable = withoutCodeBlocks(answer);
  const issues: RenderingIssue[] = [];
  for (const { kind, pattern } of UNSUPPORTED_PATTERNS) {
    if (options.beforeCitationFormatting && kind === "unreplaced-paper-marker") continue;
    const matches = scannable.match(new RegExp(pattern.source, pattern.flags));
    if (matches && matches.length > 0) {
      issues.push({
        kind: "unsupported-markdown",
        detail: kind,
        sample: sampleOf(matches[0]),
      });
    }
  }
  return issues;
}

/**
 * Tables whose rows do not match their header.
 *
 * The renderer maps cells positionally, so a row with too few cells renders
 * short and a row with too many silently loses its tail.
 */
export function brokenTables(answer: string): RenderingIssue[] {
  const lines = withoutCodeBlocks(answer).split("\n");
  const issues: RenderingIssue[] = [];
  const separator = /^\|?[\s:-]+(\|[\s:-]+)+\|?$/;
  const cellsOf = (line: string) =>
    line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").length;

  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    const next = lines[index + 1];
    if (!header.includes("|") || !next || !separator.test(next.trim())) continue;

    const headerCells = cellsOf(header);
    if (cellsOf(next) !== headerCells) {
      issues.push({
        kind: "broken-table",
        detail: `separator has ${cellsOf(next)} cells, header has ${headerCells}`,
        sample: sampleOf(header),
      });
    }
    let row = index + 2;
    while (row < lines.length && lines[row].includes("|") && lines[row].trim()) {
      const rowCells = cellsOf(lines[row]);
      if (rowCells !== headerCells) {
        issues.push({
          kind: "broken-table",
          detail: `row has ${rowCells} cells, header has ${headerCells}`,
          sample: sampleOf(lines[row]),
        });
      }
      row += 1;
    }
    index = row - 1;
  }
  return issues;
}

/**
 * A heading with nothing under it before the next heading.
 *
 * The reader sees a label promising content and then another label. It is the
 * most visible shape defect an answer can have and costs nothing to detect.
 */
export function emptySections(answer: string): RenderingIssue[] {
  // A fenced block is content, so it must not be removed here the way it is
  // for the other checks. Running this over live answers flagged a section
  // whose whole body was a chart block: stripping the block made its heading
  // look as though it sat directly on the next one.
  const lines = answer
    .replace(/```[\s\S]*?(?:```|$)/g, "\ncode block\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const heading = /^(#{1,6})\s+/;
  const issues: RenderingIssue[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    const current = lines[index].match(heading);
    const next = lines[index + 1].match(heading);
    if (!current || !next) continue;
    // A parent heading followed by its first child is ordinary document
    // structure, not an empty section: "## Findings" then "### 1. Method" reads
    // correctly. Only a heading followed by a sibling or a shallower heading
    // has genuinely promised content and delivered none.
    if (next[1].length > current[1].length) continue;
    issues.push({
      kind: "empty-section",
      detail: "a heading is followed immediately by another heading",
      sample: sampleOf(lines[index]),
    });
  }
  return issues;
}

/** Structured output that escaped into the reader's answer. */
export function leakedJson(answer: string): RenderingIssue[] {
  const scannable = withoutCodeBlocks(answer).trim();
  const issues: RenderingIssue[] = [];
  if (/^[[{]/.test(scannable)) {
    issues.push({
      kind: "leaked-json",
      detail: "answer begins as JSON",
      sample: sampleOf(scannable),
    });
  }
  const objectLike = scannable.match(
    /\{\s*"(?:answer|confidence|citations|paperIds|sufficient)"\s*:/
  );
  if (objectLike && issues.length === 0) {
    issues.push({
      kind: "leaked-json",
      detail: "a model response object appears in the text",
      sample: sampleOf(objectLike[0]),
    });
  }
  return issues;
}

/** A fence that never closes swallows the rest of the answer into a code block. */
export function unclosedCodeFence(answer: string): RenderingIssue[] {
  const fences = answer.match(/```/g)?.length ?? 0;
  if (fences % 2 === 0) return [];
  return [
    {
      kind: "unclosed-code-fence",
      detail: `${fences} fences, so one never closes`,
      sample: sampleOf(answer.slice(answer.lastIndexOf("```"))),
    },
  ];
}

/** Everything about an answer that would render wrongly for a reader. */
export function renderingIssues(
  answer: string,
  options: RenderingScanOptions = {}
): RenderingIssue[] {
  return [
    ...leakedJson(answer),
    ...unclosedCodeFence(answer),
    ...unsupportedMarkdown(answer, options),
    ...brokenTables(answer),
    ...emptySections(answer),
  ];
}

/** True when nothing in the answer would reach the reader as raw markup. */
export function rendersCleanly(answer: string, options: RenderingScanOptions = {}): boolean {
  return renderingIssues(answer, options).length === 0;
}

const NEWLINE = String.fromCharCode(10);

/** Tells a rewrite what to repair, in the words of the defect it made. */
export function renderingInstruction(issues: RenderingIssue[]): string {
  if (issues.length === 0) return "";
  const described: Record<string, string> = {
    image: "remove the image; an answer cannot show a figure",
    "horizontal-rule": "remove the horizontal rule; use a heading to separate parts",
    "nested-list": "flatten the nested list; sub-items are not displayed",
    "task-list": "use plain bullets rather than checkboxes",
    "footnote-definition": "cite inline rather than with footnote definitions",
    "html-tag": "remove the HTML; write Markdown only",
    "non-http-link": "remove the link; only full https links are shown",
    "heading-without-space": "put a space after the # of each heading",
    "unreplaced-paper-marker": "leave the [Paper N] markers exactly as they are",
  };
  return [
    "The draft contains markup the reader's view cannot display. Fix these without changing any claim, citation or number:",
    ...issues.map((issue) => `- ${described[issue.detail] ?? `${issue.kind}: ${issue.detail}`}`),
  ].join(NEWLINE);
}

/** How much of the opening a reader should not have to get past. */
export const DIRECT_ANSWER_WINDOW = 200;

/**
 * Openings that defer the answer instead of giving it.
 *
 * Deliberately narrow. "Here are the five papers" answers the question and is
 * not preamble; "Let me look at" does not and is.
 */
const PREAMBLE_PATTERNS: RegExp[] = [
  /^(?:sure|certainly|of course|absolutely)\b/i,
  /^(?:let me|i am going to|i'm going to|i will|i'll)\s+(?:look|check|start|begin|walk|explain|analyse|analyze|review)/i,
  /^(?:to answer (?:this|your)|in (?:this|my) (?:answer|response)|before (?:answering|i answer))/i,
  /^(?:based on|according to|drawing on)\s+(?:the\s+)?(?:above|following|supplied|provided|available)\s*(?:evidence|excerpts?|information|context|data)?\s*[,:]/i,
  /^(?:the following|below (?:is|are)|what follows)\b/i,
  /^(?:this (?:answer|response|report) (?:will|aims to|covers))/i,
];

/** Leading headings label the answer; they are not the answer itself. */
function openingProse(answer: string): string {
  return answer
    .split("\n")
    .filter((line) => !/^\s*#{1,6}\s+/.test(line))
    .join("\n")
    .replace(/^\s+/, "");
}

export interface DirectnessResult {
  ok: boolean;
  reason?: "preamble" | "no-substance";
  opening: string;
}

/**
 * Whether the answer opens by answering.
 *
 * A mechanical proxy, not a judgement of meaning: it checks that the first
 * {@link DIRECT_ANSWER_WINDOW} characters carry substantive prose and do not
 * open with a phrase that defers the answer. A model can still be irrelevant
 * within those characters, which is what the judge's `direct` score is for -
 * the two are complementary rather than redundant.
 */
export function leadsWithDirectAnswer(answer: string): DirectnessResult {
  const prose = openingProse(answer);
  const opening = prose.slice(0, DIRECT_ANSWER_WINDOW);
  const words = tokenizeRepositoryText(opening.replace(/[*_`>|-]/g, " "));
  if (words.length < 6) {
    return { ok: false, reason: "no-substance", opening };
  }
  for (const pattern of PREAMBLE_PATTERNS) {
    if (pattern.test(opening.trim())) {
      return { ok: false, reason: "preamble", opening };
    }
  }
  return { ok: true, opening };
}
