/*
 * Turns the checked report's [E3] citations into the chat's own citations.
 *
 * Each id becomes the parenthetical the chat renderer numbers - "(Title,
 * 2019)" for a paper, "(Page title, Web)" for a web page - and a source in
 * the message's list: a paper opens in place on its evidence, a web page links
 * to its address. The old worker printed raw database ids into the text.
 *
 * Each paper citation also carries the passage behind the sentences citing
 * it (citation-passages.ts), chosen from the passages the report was written
 * from, so the reader can see it and find it in the PDF.
 */
import { citationLabel } from "@/lib/answer-citations";
import { attachCitationPassages } from "@/lib/citation-passages";
import type { RepositoryCitation } from "@/lib/repository-chat";
import type { Evidence } from "@/lib/deep-research/types";
import { expandCitationRanges } from "@/lib/deep-research/verify";

/** Lower-case part names, as deep research v2 filed passages; a paper's own headings pass through. */
const SECTION_NAMES: Record<string, string> = {
  abstract: "Abstract",
  methods: "Methods",
  results: "Results",
  conclusion: "Conclusion",
};

/**
 * Each paper's quoted sentences, laid out as an answer's reading is: a
 * heading per quote and "[…]" between them, since they are not adjacent in
 * the paper. A passage trimmed to length ends in "…", which is not the paper's.
 * A paper's own entry (cited for what it does not report) has no passage.
 */
function evidenceReadings(evidence: Map<string, Evidence>): Map<string, string> {
  const readings = new Map<string, string[]>();
  for (const item of evidence.values()) {
    if (item.kind !== "paper" || item.record) continue;
    const text = item.text.replace(/…\s*$/, "").trim();
    if (!text) continue;
    const section = item.section ? SECTION_NAMES[item.section] ?? item.section.replace(/^#+\s*/, "").trim() : undefined;
    readings.set(item.sourceId, [...(readings.get(item.sourceId) ?? []), `${section ? `### ${section}\n` : "### Text\n"}${text}`]);
  }
  return new Map([...readings].map(([paperId, parts]) => [paperId, parts.join("\n[…]\n")]));
}

const CITE_GROUP = /\s*\[((?:E\d{1,3})(?:\s*[,;]\s*E\d{1,3})*)\]/g;

function labelFor(item: Evidence): string {
  return item.kind === "web" ? citationLabel({ title: item.title, year: "Web" }) : citationLabel({ title: item.title, year: item.year });
}

/** A title that cannot break the parentheses and semicolons it sits between. */
function safeTitle(title: string): string {
  return title.replace(/[()[\];]+/g, " ").replace(/\s+/g, " ").trim() || "Untitled";
}

export function finalizeReport(report: string, evidence: Map<string, Evidence>): { text: string; citations: RepositoryCitation[] } {
  const citations = new Map<string, RepositoryCitation>();
  let webNumber = 0;
  const cite = (item: Evidence): string => {
    const clean = { ...item, title: safeTitle(item.title) };
    const key = item.kind === "web" ? `web:${item.url ?? item.sourceId}` : `paper:${item.sourceId}`;
    if (!citations.has(key)) {
      if (item.kind === "web") {
        webNumber += 1;
        citations.set(key, { paperId: `Web ${webNumber}`, title: clean.title, year: "Web", href: item.url ?? item.sourceId, reason: item.text.slice(0, 220), sourceType: "web" });
      } else {
        citations.set(key, {
          paperId: item.sourceId,
          title: clean.title,
          year: item.year,
          href: `/workspace/library?paperId=${encodeURIComponent(item.sourceId)}`,
          reason: item.text.slice(0, 220),
          sourceType: "paper",
        });
      }
    }
    return labelFor(clean);
  };
  const text = expandCitationRanges(report).replace(CITE_GROUP, (_whole, inner: string) => {
    const labels: string[] = [];
    for (const id of inner.split(/\s*[,;]\s*/)) {
      const item = evidence.get(id);
      if (!item) continue;
      const label = cite(item);
      if (!labels.includes(label)) labels.push(label);
    }
    return labels.length ? ` (${labels.join("; ")})` : "";
  });
  // "... found X (A, 2019)." - the citation sits before the sentence's full stop.
  const tidy = text.replace(/\.\s*\(([^()]+)\)(?=\s|$)/g, " ($1).").replace(/\s+([.,;:!?])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  return {
    text: tidy,
    citations: attachCitationPassages(tidy, [...citations.values()], { readings: evidenceReadings(evidence) }),
  };
}
