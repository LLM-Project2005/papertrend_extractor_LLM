/**
 * Readability rules for chat answers.
 *
 * Measured on live answers, the synthesis paths produced walls of text: a
 * 2,812-character corpus summary in a single paragraph, an 11,970-character
 * topic answer with no bullets and no bold at all, and 13 of 21 answers with no
 * bullets anywhere. The prompts asked for structure; nothing checked it.
 */

/** Longest a single paragraph may run before it stops being scannable. */
export const MAX_PARAGRAPH_CHARS = 700;

/** Above this length an answer needs headings, bullets or a table. */
export const STRUCTURE_REQUIRED_CHARS = 900;

/** Beyond this an answer is a document, not a reply, and stops being read. */
export const MAX_ANSWER_CHARS = 7_000;

/** A prose paragraph longer than this is expected to carry a citation. */
const CLAIM_PARAGRAPH_CHARS = 220;

export type ReadabilityIssueKind =
  | "long_paragraph"
  | "no_structure"
  | "no_emphasis"
  | "too_long"
  | "unattributed_claims";

export interface ReadabilityIssue {
  kind: ReadabilityIssueKind;
  detail: string;
}

function paragraphsOf(answer: string): string[] {
  return answer
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isStructural(paragraph: string): boolean {
  // Headings, list items and table rows are already scannable, so their length
  // is not what makes an answer hard to read.
  return /^(#{1,6}\s|\s*[-*+]\s|\s*\d+[.)]\s|\|)/.test(paragraph);
}

export function countBullets(answer: string): number {
  return (answer.match(/^\s*(?:[-*+]|\d+[.)])\s+\S/gm) ?? []).length;
}

export function countHeadings(answer: string): number {
  return (answer.match(/^#{1,6}\s+\S/gm) ?? []).length;
}

export function countTableRows(answer: string): number {
  return (answer.match(/^\s*\|.*\|\s*$/gm) ?? []).length;
}

export function countBold(answer: string): number {
  return (answer.match(/\*\*[^*\n]+\*\*/g) ?? []).length;
}

/** Lists everything about an answer's shape that would make it hard to read. */
export function readabilityIssues(answer: string): ReadabilityIssue[] {
  const text = (answer ?? "").trim();
  if (!text) return [];
  const issues: ReadabilityIssue[] = [];

  const overlong = paragraphsOf(text)
    .filter((paragraph) => !isStructural(paragraph) && paragraph.length > MAX_PARAGRAPH_CHARS)
    .sort((left, right) => right.length - left.length);
  if (overlong.length > 0) {
    issues.push({
      kind: "long_paragraph",
      detail:
        `${overlong.length} paragraph${overlong.length === 1 ? "" : "s"} exceed ${MAX_PARAGRAPH_CHARS} characters ` +
        `(longest ${overlong[0].length}). Break them up or turn the enumerated parts into bullets.`,
    });
  }

  const structural = countHeadings(text) + countBullets(text) + countTableRows(text);
  if (text.length > STRUCTURE_REQUIRED_CHARS && structural === 0) {
    issues.push({
      kind: "no_structure",
      detail:
        `A ${text.length}-character answer has no headings, bullets or table. ` +
        "Add headings for each part of the answer and bullets for anything enumerated.",
    });
  }

  if (text.length > MAX_ANSWER_CHARS) {
    issues.push({
      kind: "too_long",
      detail:
        `The answer is ${text.length} characters, past the ${MAX_ANSWER_CHARS} a reader will work through. ` +
        "Cut repetition and secondary detail rather than summarising away the substance.",
    });
  }

  const unattributed = paragraphsOf(text).filter(
    (paragraph) =>
      !isStructural(paragraph) &&
      paragraph.length > CLAIM_PARAGRAPH_CHARS &&
      !/\[Paper\s+[^\]]+\]/i.test(paragraph) &&
      !/\([^()]{12,120}?,\s*(?:\d{4}|Unknown)\)/.test(paragraph)
  );
  if (unattributed.length > 0) {
    issues.push({
      kind: "unattributed_claims",
      detail:
        `${unattributed.length} substantive paragraph${unattributed.length === 1 ? "" : "s"} cite no paper. ` +
        "Attribute each claim to the paper it came from, or say plainly that the evidence does not support it.",
    });
  }

  if (text.length > STRUCTURE_REQUIRED_CHARS && countBold(text) === 0) {
    issues.push({
      kind: "no_emphasis",
      detail:
        "Nothing is emphasised. Bold the specific findings, figures and paper names a reader is scanning for.",
    });
  }

  return issues;
}

/** True when the answer is shaped well enough to read without reformatting. */
export function isReadable(answer: string): boolean {
  return readabilityIssues(answer).length === 0;
}

/** Instruction appended to a rewrite request when an answer reads poorly. */
export function readabilityInstruction(issues: ReadabilityIssue[]): string {
  if (issues.length === 0) return "";
  return [
    "The draft is hard to read. Fix these without changing any claim, citation or number:",
    ...issues.map((issue) => `- ${issue.detail}`),
  ].join("\n");
}

/**
 * House style for every generated answer.
 *
 * Kept in one place so the synthesis prompt and the rewrite prompt cannot drift
 * apart and give the model contradictory instructions.
 */
export const ANSWER_FORMAT_RULES = [
  "Open with the direct answer in one or two sentences, before any heading.",
  `Keep every paragraph under ${MAX_PARAGRAPH_CHARS} characters; split longer reasoning into separate paragraphs.`,
  "Use a bulleted list whenever you enumerate three or more things, rather than running them into a sentence.",
  "Use a Markdown table when the content is genuinely tabular, such as a value per paper.",
  "Bold the specific findings, figures and paper names a reader scans for, but no more than a few per paragraph.",
  "Use a descriptive heading for each distinct part of a long answer.",
  "Do not pad. Say less rather than repeating a claim in different words.",
  `Stay under ${MAX_ANSWER_CHARS} characters; depth means specifics, not length.`,
  "Attribute every substantive claim to the paper it came from.",
  "Cite a paper by its title exactly as stored, even when answering in another language; a translated title cannot be matched against the repository or checked by the reader.",
  "Use only headings, bullets, numbered lists, tables, bold, italic, inline code and full https links. Images, horizontal rules, indented sub-bullets, checkboxes and HTML are not displayed and reach the reader as raw punctuation.",
  "Never put a heading directly under another heading; every heading needs content beneath it.",
].join(" ");
