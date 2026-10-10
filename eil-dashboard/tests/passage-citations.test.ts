import assert from "node:assert/strict";
import test from "node:test";
import {
  QUOTE_MAX_CHARS,
  attachCitationPassages,
  bestPassage,
  citedClaims,
  passageWindows,
  readingSegments,
} from "../src/lib/citation-passages";
import {
  citationLabel,
  markCitations,
  numberCitationMarkers,
  passageForMarker,
} from "../src/lib/answer-citations";
import { PAPER_QUOTE_MAX, libraryPaperHref, parsePaperHref, readPaperQuote } from "../src/lib/paper-address";
import { finalizeReport } from "../src/lib/deep-research/finalize";
import { answerMarkdown } from "../src/lib/answer-export";
import { passageTarget } from "../src/components/chat/AnswerBody";
import type { Evidence } from "../src/lib/deep-research/types";

/**
 * The passage behind each citation (citation-passages.ts): which passage is
 * chosen, that it is the paper's own words, that it stays short, and that a
 * marker on screen gets the passage found for its own sentence.
 */

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/** A paper as paper-reading.ts lays it out for an answer to read. */
const PEER_READING = [
  "### Abstract",
  "This study examined peer feedback in an EFL writing course at a Thai university. Sixty second-year students took part over one semester.",
  "",
  "### Methods",
  "Participants were divided into two groups of thirty. The experimental group exchanged written peer feedback on each draft, while the control group received teacher feedback only. Writing was scored with an analytic rubric out of 40 points.",
  "",
  "### Results",
  "The experimental group's mean writing score rose from 21.4 to 29.8, while the control group's rose from 21.9 to 24.1. The difference between the groups was significant (p < .01). Students also reported more confidence when revising their drafts.",
  "",
  "### Conclusion",
  "Peer feedback can complement teacher feedback in large writing classes.",
].join("\n");

const PEER = {
  paperId: "101",
  title: "Peer Feedback in EFL Writing",
  year: "2021",
  href: "/workspace/library?paperId=101",
  reason: "Cited in the grounded repository answer.",
  sourceType: "paper" as const,
};

const SPEAKING_READING = [
  "### Abstract",
  "This paper reports a speaking course that used recorded role plays with first-year nursing students.",
  "",
  "### Findings",
  "Fluency ratings improved after eight weeks of recorded role plays, and anxiety scores fell for most of the students.",
].join("\n");

const SPEAKING = {
  paperId: "202",
  title: "Recorded Role Plays for Nursing Students",
  year: "2019",
  href: "/workspace/library?paperId=202",
  reason: "Cited in the grounded repository answer.",
  sourceType: "paper" as const,
};

/* ---------------------------------------------------------------- choosing */

test("the passage chosen is the one that supports the claim, with its section", () => {
  const passage = bestPassage(
    "Peer feedback raised the mean writing score from 21.4 to 29.8, well above the teacher-feedback group.",
    passageWindows(PEER_READING, PEER.title)
  );
  assert.ok(passage, "a supporting passage is found");
  assert.match(passage.quote, /rose from 21\.4 to 29\.8/);
  assert.equal(passage.section, "Results");
});

test("a quote is the paper's own words, never longer than the limit", () => {
  const passage = bestPassage("Sixty second-year students took part over one semester.", passageWindows(PEER_READING, PEER.title));
  assert.ok(passage);
  assert.ok(flat(PEER_READING).includes(passage.quote), "verbatim from the text the answer read");
  assert.ok(passage.quote.length <= QUOTE_MAX_CHARS);
  assert.equal(passage.section, "Abstract");

  // A run with no sentence ends at all is still cut to a readable length.
  const unpunctuated = `### Text\n${Array.from({ length: 160 }, (_, index) => `word${index} retention`).join(" ")}`;
  const long = bestPassage("retention word40 word41 word42", passageWindows(unpunctuated));
  assert.ok(long);
  assert.ok(long.quote.length <= QUOTE_MAX_CHARS, `${long.quote.length} characters`);
  assert.ok(flat(unpunctuated).includes(long.quote));
  assert.equal(long.section, undefined, "\"Text\" is no section name");
});

test("a claim that shares too little with the paper gets no quote", () => {
  const windows = passageWindows(PEER_READING, PEER.title);
  assert.equal(bestPassage("Vocabulary tests favoured the mobile application group.", windows), null);
  // Only the paper's title words: that names the paper, it is not evidence.
  assert.equal(bestPassage("Peer feedback in EFL writing.", windows), null);
  assert.equal(bestPassage("", windows), null);
});

test("a quote never spans text the answer did not read", () => {
  const reading = "### Results\nScores rose sharply in the first month of the programme.\n[…]\nAttendance fell sharply in the final month of the programme.";
  assert.deepEqual(readingSegments(reading).map((segment) => segment.text), [
    "Scores rose sharply in the first month of the programme.",
    "Attendance fell sharply in the final month of the programme.",
  ]);
  const passage = bestPassage("Scores rose sharply in the first month while attendance fell in the final month.", passageWindows(reading));
  assert.ok(passage);
  assert.ok(!passage.quote.includes("[…]"));
  assert.ok(!(passage.quote.includes("Scores") && passage.quote.includes("Attendance")), "the two sides of the gap are not joined");
});

test("Thai: the supporting clause is found, verbatim and bounded", () => {
  const filler = Array.from({ length: 14 }, () => "การจัดกิจกรรมในชั้นเรียนดำเนินการตามแผนการสอนที่กำหนดไว้ทุกสัปดาห์").join(" ");
  const reading = [
    "### บทคัดย่อ",
    "งานวิจัยนี้ศึกษาการใช้แอปพลิเคชันฝึกออกเสียงภาษาอังกฤษกับนักเรียนชั้นมัธยมศึกษาปีที่ 3 จำนวน 45 คน",
    "",
    "### วิธีดำเนินการวิจัย",
    filler,
    "",
    "### ผลการวิจัย",
    "คะแนนการออกเสียงหลังเรียนสูงกว่าก่อนเรียนอย่างมีนัยสำคัญทางสถิติที่ระดับ .05 นักเรียนมีความพึงพอใจต่อแอปพลิเคชันในระดับมาก",
  ].join("\n");
  const windows = passageWindows(reading, "การพัฒนาการออกเสียงด้วยแอปพลิเคชัน");
  const passage = bestPassage("คะแนนการออกเสียงของนักเรียนหลังเรียนสูงขึ้นอย่างมีนัยสำคัญทางสถิติ", windows);
  assert.ok(passage, "a Thai passage is found");
  assert.match(passage.quote, /คะแนนการออกเสียงหลังเรียน/);
  assert.equal(passage.section, "ผลการวิจัย");
  assert.ok(flat(reading).includes(passage.quote), "verbatim");
  // The long run of clauses is cut into windows no longer than the limit.
  assert.ok(windows.windows.every((window) => window.text.length <= QUOTE_MAX_CHARS));
  const method = bestPassage("กิจกรรมในชั้นเรียนดำเนินการตามแผนการสอนทุกสัปดาห์", windows);
  assert.ok(method && method.quote.length <= QUOTE_MAX_CHARS && method.section === "วิธีดำเนินการวิจัย");
});

/* ----------------------------------------------------------- whole answers */

const ANSWER = [
  `Peer feedback raised the mean writing score from 21.4 to 29.8 (${citationLabel(PEER)}).`,
  `That study had sixty second-year students over one semester (${citationLabel(PEER)}).`,
  `Recorded role plays improved fluency ratings for nursing students (${citationLabel(SPEAKING)}).`,
].join(" ");

const READINGS = new Map([
  [PEER.paperId, PEER_READING],
  [SPEAKING.paperId, SPEAKING_READING],
]);

test("each marker's claim is the sentence it closes, counted as the renderer counts", () => {
  const claims = citedClaims(ANSWER, [PEER, SPEAKING]);
  assert.deepEqual(claims.map((claim) => [claim.at, claim.paperIds]), [[0, ["101"]], [1, ["101"]], [2, ["202"]]]);
  assert.match(claims[1].claim, /^That study had sixty/);
  assert.doesNotMatch(claims[1].claim, /21\.4/, "the earlier sentence is not part of this claim");
  // The renderer numbers the same markers in the same order.
  const numbered = numberCitationMarkers(markCitations(ANSWER, [PEER, SPEAKING]).text);
  assert.deepEqual([...numbered.matchAll(/@(\d+)\]\]/g)].map((match) => Number(match[1])), [0, 1, 2]);
});

test("two places citing one paper each get their own passage", () => {
  const [peer, speaking] = attachCitationPassages(ANSWER, [PEER, SPEAKING], { readings: READINGS });
  assert.equal(peer.passages?.length, 2);
  assert.match(passageForMarker(peer, 0)?.quote ?? "", /21\.4 to 29\.8/);
  assert.match(passageForMarker(peer, 1)?.quote ?? "", /Sixty second-year students/);
  assert.equal(peer.quote, peer.passages?.[0].quote, "the citation's own quote is its first claim's");
  assert.equal(peer.section, "Results");
  assert.match(speaking.quote ?? "", /Fluency ratings improved/);
  assert.equal(speaking.section, "Findings");
  // A marker whose sentence found nothing shows nothing, rather than another sentence's passage.
  assert.equal(passageForMarker(peer, 7), null);
  // Without a place (an older report) the citation's quote stands for the paper.
  assert.equal(passageForMarker(peer)?.quote, peer.quote);
});

test("a paper cited without a marker is quoted for what its section says", () => {
  const answer = `### 1. ${PEER.title}\nThe paper compares peer and teacher feedback; the peer group's score rose from 21.4 to 29.8.`;
  const [peer] = attachCitationPassages(answer, [PEER], {
    readings: READINGS,
    claims: new Map([[PEER.paperId, ["The paper compares peer and teacher feedback; the peer group's score rose from 21.4 to 29.8."]]]),
  });
  assert.match(peer.quote ?? "", /21\.4 to 29\.8/);
  assert.equal(peer.passages, undefined, "no marker, so no per-marker passages");
});

test("web pages and papers whose text was not read are left as they are", () => {
  const web = { paperId: "Web 1", title: "Ministry guidance", year: "Web", href: "https://example.org/p", reason: "", sourceType: "web" as const };
  const unread = { ...SPEAKING, paperId: "303", href: "/workspace/library?paperId=303", title: "An Unread Paper" };
  const answer = `${ANSWER} Fluency ratings improved too (${citationLabel(unread)}). Guidance followed (${citationLabel(web)}).`;
  const result = attachCitationPassages(answer, [PEER, SPEAKING, unread, web], { readings: READINGS });
  assert.deepEqual(result[2], unread);
  assert.deepEqual(result[3], web);
});

/* ------------------------------------------------------------ deep research */

test("a research report's citations quote the passages it was written from", () => {
  const evidence: Evidence[] = [
    { id: "E1", kind: "paper", sourceId: "101", title: PEER.title, year: "2021", section: "results", text: "The experimental group's mean writing score rose from 21.4 to 29.8, while the control group's rose from 21.9 to 24.1. Students also reported more…" },
    { id: "E2", kind: "paper", sourceId: "101", title: PEER.title, year: "2021", section: "abstract", text: "Sixty second-year students took part over one semester." },
  ];
  const final = finalizeReport("Peer feedback raised writing scores from 21.4 to 29.8 [E1]. The sample was sixty students [E2].", new Map(evidence.map((item) => [item.id, item])));
  const [citation] = final.citations;
  assert.match(citation.quote ?? "", /21\.4 to 29\.8/);
  assert.equal(citation.section, "Results");
  assert.ok(!(citation.quote ?? "").includes("…"), "a trimmed passage's ellipsis is not the paper's");
  assert.match(passageForMarker(citation, 1)?.quote ?? "", /Sixty second-year students/);
});

/* ---------------------------------------------------------------- the export */

test("an exported answer quotes the passage under its source", () => {
  const [peer] = attachCitationPassages(ANSWER, [PEER, SPEAKING], { readings: READINGS });
  const markdown = answerMarkdown(`Scores rose (${citationLabel(PEER)}).`, [peer]);
  assert.match(markdown, /## Sources\n\n1\. Peer Feedback in EFL Writing \(2021\)\.\n {3}> The experimental group's mean writing score rose from 21\.4 to 29\.8.* \(Results\)\n/);
});

/* ---------------------------------------------------------------- the address */

test("a quoted passage survives the paper's address, both ways", () => {
  const quote = "The experimental group's mean writing score rose from 21.4 to 29.8 (p < .01) & more.";
  const href = libraryPaperHref({ paperId: "101", tab: "preview", quote });
  assert.deepEqual(parsePaperHref(href), { runId: null, paperId: "101", tab: "preview", quote });
  const thai = "คะแนนการออกเสียงหลังเรียนสูงกว่าก่อนเรียน อย่างมีนัยสำคัญ";
  assert.equal(parsePaperHref(libraryPaperHref({ runId: "run-1", tab: "preview", quote: thai }))?.quote, thai);
  // An address without one reads exactly as before.
  assert.deepEqual(parsePaperHref("/workspace/library?paperId=101&tab=evidence"), { runId: null, paperId: "101", tab: "evidence" });
  assert.equal(libraryPaperHref({ paperId: "101", quote: "  " }), "/workspace/library?paperId=101");
});

test("a passage in an address is tidied and bounded", () => {
  assert.equal(readPaperQuote("  two\n  lines  "), "two lines");
  assert.equal(readPaperQuote(""), null);
  assert.equal(readPaperQuote(null), null);
  assert.equal(readPaperQuote("x".repeat(5_000))?.length, PAPER_QUOTE_MAX);
});

test("a citation's passage opens the paper's PDF with the passage", () => {
  const passage = { quote: "Sixty second-year students took part over one semester." };
  assert.deepEqual(passageTarget("/workspace/library?paperId=101", passage), { runId: null, paperId: "101", tab: "preview", quote: passage.quote });
  assert.equal(passageTarget("https://example.org/p", passage), null, "a web page is not opened in the paper window");
  assert.equal(passageTarget("javascript:alert(1)", passage), null);
});
