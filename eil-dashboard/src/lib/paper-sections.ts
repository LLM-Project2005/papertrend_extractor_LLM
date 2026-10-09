/**
 * A paper's own sections, read from the headings printed in its stored text.
 *
 * The analysis keeps four parts of each paper (abstract, methods, results,
 * conclusion), so "count the words in each section" used to answer with those
 * four and put the introduction, literature review, discussion and references
 * only into the whole-paper total (the test account's chat, 2026-10-09). The
 * stored text keeps its line breaks and headings - plain, numbered, or marked up
 * by the OCR step as "## Methodology" or "**Introduction**" - so the parts a
 * reader means can be found again. Measured on the test account's 40 papers:
 * every one split into 4-10 parts in reading order.
 */

export type PaperSectionKey =
  | "front_matter"
  | "abstract"
  | "introduction"
  | "literature_review"
  | "methods"
  | "results_discussion"
  | "results"
  | "discussion"
  | "conclusion"
  | "implications"
  | "acknowledgements"
  | "references"
  | "appendix";

export interface PaperSection {
  key: PaperSectionKey;
  /** The heading as printed, without numbering or mark-up. */
  heading: string;
  text: string;
}

interface Canon {
  key: Exclude<PaperSectionKey, "front_matter">;
  /** Reading order; two parts of the same rank may follow each other. */
  rank: number;
  pattern: string;
}

const CANON: Canon[] = [
  { key: "abstract", rank: 0, pattern: "abstract|บทคัดย่อ" },
  {
    key: "introduction",
    rank: 1,
    pattern: "introduction|background(?: of the study)?|rationale(?: of the study)?|บทนำ|ความเป็นมา(?:และความสำคัญของปัญหา)?",
  },
  {
    key: "literature_review",
    rank: 2,
    pattern:
      "review of (?:the )?(?:related )?literature|literature review|related (?:literature|studies|works?)|theoretical (?:and conceptual )?framework|conceptual framework|theoretical background|การทบทวนวรรณกรรม|วรรณกรรมที่เกี่ยวข้อง|แนวคิดและทฤษฎี(?:ที่เกี่ยวข้อง)?",
  },
  {
    key: "methods",
    rank: 3,
    pattern: "(?:research )?methodology|(?:research )?methods?|materials and methods|research design|วิธี(?:ดำเนินการ)?วิจัย|ระเบียบวิธีวิจัย",
  },
  { key: "results_discussion", rank: 4, pattern: "(?:(?:research )?results?|findings?) and discussions?" },
  { key: "results", rank: 4, pattern: "(?:research )?results?|(?:research )?findings?|ผลการวิจัย|ผลการศึกษา" },
  { key: "discussion", rank: 5, pattern: "discussions?|อภิปรายผล|การอภิปรายผล" },
  {
    key: "conclusion",
    rank: 6,
    pattern:
      "(?:implications? and )?conclusions?(?: and (?:implications?|recommendations?|suggestions?))?|concluding remarks|summary and conclusions?|สรุป(?:ผล)?(?:การวิจัย)?(?:และข้อเสนอแนะ)?",
  },
  {
    key: "implications",
    rank: 6,
    pattern:
      "(?:pedagogical |practical |theoretical )?implications?(?: of the (?:study|study findings|findings|research))?|recommendations?|suggestions? for (?:further|future) (?:research|studies)|limitations?(?: of the study)?(?: and (?:recommendations?|suggestions?))?|ข้อเสนอแนะ",
  },
  { key: "acknowledgements", rank: 7, pattern: "acknowledge?ments?|กิตติกรรมประกาศ" },
  { key: "references", rank: 8, pattern: "references?|bibliography|works cited|เอกสารอ้างอิง|บรรณานุกรม" },
  { key: "appendix", rank: 9, pattern: "appendix(?:es)?|appendices|ภาคผนวก" },
];

// "1.", "2.0", "IV.", "Chapter 2", "บทที่ 3" before the heading itself.
const NUMBERING = "(?:(?:chapter|บทที่)\\s*(?:\\d+|[ivx]+)[.:]?\\s*|(?:\\d{1,2}(?:\\.0)?|[ivx]{1,4})\\.?\\s+)?";
const MATCHERS = CANON.map((canon) => ({ ...canon, regex: new RegExp(`^${NUMBERING}(?:${canon.pattern})\\s*:?$`, "iu") }));
const RANK = new Map(CANON.map((canon) => [canon.key, canon.rank]));

export const SECTION_LABELS: Record<PaperSectionKey, { en: string; th: string }> = {
  front_matter: { en: "Title and authors", th: "ชื่อเรื่องและผู้แต่ง" },
  abstract: { en: "Abstract", th: "บทคัดย่อ" },
  introduction: { en: "Introduction", th: "บทนำ" },
  literature_review: { en: "Literature review", th: "การทบทวนวรรณกรรม" },
  methods: { en: "Methods", th: "วิธีวิจัย" },
  results_discussion: { en: "Results and discussion", th: "ผลและการอภิปราย" },
  results: { en: "Results", th: "ผลการวิจัย" },
  discussion: { en: "Discussion", th: "การอภิปรายผล" },
  conclusion: { en: "Conclusion", th: "สรุป" },
  implications: { en: "Implications", th: "ข้อเสนอแนะ" },
  acknowledgements: { en: "Acknowledgements", th: "กิตติกรรมประกาศ" },
  references: { en: "References", th: "เอกสารอ้างอิง" },
  appendix: { en: "Appendix", th: "ภาคผนวก" },
};

/** Reading order of every part, for a table with one column per part. */
export const SECTION_ORDER: PaperSectionKey[] = [
  "front_matter",
  "abstract",
  "introduction",
  "literature_review",
  "methods",
  "results_discussion",
  "results",
  "discussion",
  "conclusion",
  "implications",
  "acknowledgements",
  "references",
  "appendix",
];

function stripMarkup(cell: string): string {
  return cell
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[*_]{1,3}(.*?)[*_]{1,3}$/, "$1")
    .trim();
}

/** The heading candidates on one line, each with whether it was marked as a heading. */
function candidates(line: string): Array<{ text: string; marked: boolean }> {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("|")) {
    // A table row from the OCR step: journals print the abstract in a front-matter table.
    return trimmed
      .replace(/^\||\|$/g, "")
      .split("|")
      .map((cell) => cell.trim())
      .map((cell) => ({ text: stripMarkup(cell), marked: /^(?:#{1,6}\s*|[*_]{2,3})/.test(cell) }))
      .filter((cell) => cell.text.length > 0 && cell.text.length <= 70);
  }
  const text = stripMarkup(trimmed);
  return text.length > 0 && text.length <= 70 ? [{ text, marked: true }] : [];
}

interface Hit {
  line: number;
  key: Canon["key"];
  heading: string;
}

/**
 * The paper's parts in reading order, or null when fewer than three headings
 * could be read (the caller then falls back to the parts the analysis stored).
 */
export function splitPaperSections(text: string): PaperSection[] | null {
  const lines = text.split("\n");
  const hits: Hit[] = [];
  lines.forEach((line, index) => {
    for (const candidate of candidates(line)) {
      const match = MATCHERS.find((matcher) => matcher.regex.test(candidate.text));
      // A plain table cell is a heading only for the abstract; "Results" in a
      // table of results is not.
      if (match && (candidate.marked || match.key === "abstract")) {
        hits.push({ line: index, key: match.key, heading: candidate.text });
        return;
      }
    }
  });
  if (hits.length === 0) return null;

  // The run of headings in reading order that names the most parts. One out of
  // order sits in a table, a quotation, a thesis's front matter or an appendix.
  // A part named again adds nothing (a second "Abstract" in another language
  // must not cost the introduction), and ties go to the nearer heading, so a
  // stray "Conclusion" inside the methods does not swallow the results after it.
  const best = hits.map(() => 1);
  const previous = hits.map(() => -1);
  for (let j = 0; j < hits.length; j += 1) {
    for (let i = 0; i < j; i += 1) {
      const gain = hits[i].key === hits[j].key ? 0 : 1;
      if ((RANK.get(hits[i].key) ?? 0) <= (RANK.get(hits[j].key) ?? 0) && best[i] + gain >= best[j]) {
        best[j] = best[i] + gain;
        previous[j] = i;
      }
    }
  }
  let end = 0;
  for (let k = 1; k < hits.length; k += 1) if (best[k] > best[end]) end = k;
  const chain: Hit[] = [];
  for (let k = end; k !== -1; k = previous[k]) chain.unshift(hits[k]);
  // The same part named twice in a row ("Methodology", then "Research methods")
  // is a sub-heading inside it.
  const marks = chain.filter((hit, index) => index === 0 || chain[index - 1].key !== hit.key);
  if (marks.length < 3) return null;

  const sections: PaperSection[] = [];
  const opening = lines.slice(0, marks[0].line).join("\n").trim();
  if (opening) sections.push({ key: "front_matter", heading: SECTION_LABELS.front_matter.en, text: opening });
  marks.forEach((mark, index) => {
    const stop = index + 1 < marks.length ? marks[index + 1].line : lines.length;
    sections.push({ key: mark.key, heading: mark.heading, text: lines.slice(mark.line + 1, stop).join("\n").trim() });
  });
  return sections;
}
