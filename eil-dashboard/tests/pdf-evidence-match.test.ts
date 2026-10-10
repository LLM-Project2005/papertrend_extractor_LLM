import assert from "node:assert/strict";
import test from "node:test";
import { indexPage, locateEvidence, normalizeForMatch } from "../src/lib/pdf-evidence-match";

const page = (...runs: string[]) => ({ runs });

test("normalisation folds case, punctuation, accents and ligatures", () => {
  assert.equal(normalizeForMatch("  Peer-Feedback, in the Classroom! "), "peer feedback in the classroom");
  assert.equal(normalizeForMatch("café eﬃcient"), "cafe efficient");
});

test("a line-end hyphen joins the word it split", () => {
  const index = indexPage(page("the informa-", "tion was coded"));
  assert.equal(index.text, "the information was coded ");
});

test("the whole sentence is found across runs on the right page", () => {
  const pages = [
    page("Introduction", "Writing research has grown."),
    page("Results", "Students who received peer", "feedback revised more often", "than those who did not."),
  ];
  const found = locateEvidence(pages, "Students who received peer feedback revised more often than those who did not.");
  assert.equal(found?.page, 1);
  assert.deepEqual(found?.runs, [1, 2, 3]);
  assert.equal(found?.quality, "exact");
  assert.deepEqual(found?.trim, { start: 0, end: 1 }, "the passage fills those runs exactly");
});

test("shortened evidence still lands on its lines", () => {
  const pages = [
    page("unrelated text on the first page about something else entirely"),
    page(
      "The intervention improved listening comprehension scores for",
      "most participants, particularly those at the intermediate level,",
      "while beginners showed smaller gains over the semester."
    ),
  ];
  const found = locateEvidence(
    pages,
    "The intervention improved listening comprehension scores for most participants ... beginners showed smaller gains over the semester"
  );
  assert.equal(found?.page, 1);
  assert.equal(found?.quality, "partial");
  assert.ok(found && found.runs.includes(0) && found.runs.includes(2));
});

test("evidence that is not in the PDF is reported as not found", () => {
  const pages = [page("This page is about coastal flooding and mangroves in Southeast Asia.")];
  assert.equal(locateEvidence(pages, "Teachers reported that dynamic assessment supported learner autonomy."), null);
  assert.equal(locateEvidence(pages, "too short"), null, "a few words are too weak to highlight");
});

test("a mark stops where the sentence stops inside a line", () => {
  const pages = [page("Earlier text. These two approaches differ in purpose.", "In the other approach the mediation is formal.")];
  const found = locateEvidence(pages, "These two approaches differ in purpose.");
  assert.equal(found?.runs.length, 1);
  assert.ok(found && found.trim.start > 0.2 && found.trim.start < 0.4, `starts partway in (${found?.trim.start})`);
  assert.ok(found && found.trim.end > 0.95, "and runs to the end of that run");
});

test("a word split across runs, or a page with no spaces, is still found", () => {
  const quote = "A total of 60 learners were involved in the research: 30 Thai B1-level learners and 30 Thai C1-level EFL learners.";
  // pdf.js gives a word as two runs where the font or kerning changes.
  const split = [page("Method"), page("A total of 60 lear", "ners were involved in the research: 30 Thai B1-level", "learners and 30 Thai C1-level EFL learners.", "Instruments")];
  const found = locateEvidence(split, quote);
  assert.equal(found?.page, 1);
  assert.deepEqual(found?.runs, [0, 1, 2]);
  // Some PDFs place each word by position and give no spaces at all.
  const unspaced = [page("Atotalof60learnerswereinvolvedintheresearch:30ThaiB1-level", "learnersand30ThaiC1-levelEFLlearners.")];
  assert.deepEqual(locateEvidence(unspaced, quote)?.runs, [0, 1]);
  assert.equal(locateEvidence([page("Forty teachers took part in the survey of schools.")], quote), null, "a different sentence is still not found");
});
