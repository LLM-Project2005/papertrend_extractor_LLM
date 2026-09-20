import assert from "node:assert/strict";
import test from "node:test";
import { splitTextPassages } from "../src/lib/repository-text";
import { rankRepositoryEvidence } from "../src/lib/repository-retrieval";
import type { RepositoryRetrievalDocument } from "../src/lib/repository-retrieval";

const THAI_BODY = [
  "การศึกษานี้มุ่งเน้นการใช้ภาษาอังกฤษเป็นภาษานานาชาติในห้องเรียนไทย",
  "ผู้วิจัยเก็บข้อมูลจากครูจำนวนสามสิบคนในโรงเรียนมัธยมศึกษา",
  "ผลการวิจัยพบว่าผู้เรียนมีทัศนคติเชิงบวกต่อการสอนแบบสื่อสาร",
  "อย่างไรก็ตามครูยังขาดความมั่นใจในการออกเสียงภาษาอังกฤษ",
  "สรุปได้ว่าการพัฒนาครูอย่างต่อเนื่องมีความจำเป็นอย่างยิ่ง",
].join(" ");

function doc(overrides: Partial<RepositoryRetrievalDocument> = {}): RepositoryRetrievalDocument {
  return {
    paperId: "1",
    title: "Untitled",
    abstract: "",
    methods: "",
    results: "",
    conclusion: "",
    content: "",
    year: "2024",
    topics: [],
    keywords: [],
    ...overrides,
  } as RepositoryRetrievalDocument;
}

test("Thai body text splits into several passages instead of one blob", () => {
  // Repeat the body so it comfortably exceeds one window.
  const long = new Array(8).fill(THAI_BODY).join(" ");
  const passages = splitTextPassages(long);
  assert.ok(
    passages.length > 1,
    `Thai text should split into multiple passages, got ${passages.length}`
  );
  passages.forEach((passage) => {
    assert.ok(passage.length <= 1_200, `passage too long: ${passage.length}`);
  });
});

test("short Thai text stays a single passage", () => {
  const passages = splitTextPassages(THAI_BODY);
  assert.equal(passages.length, 1);
  assert.equal(passages[0], THAI_BODY);
});

test("English sentence splitting is preserved", () => {
  const english = [
    "This study examines peer feedback in English writing classrooms across three schools.",
    "The researchers collected data from thirty teachers using a mixed-method design.",
    "Results show that revision quality improved after structured feedback was introduced.",
  ].join(" ");
  const passages = splitTextPassages(english, { minLength: 40 });
  assert.equal(passages.length, 3);
  assert.match(passages[0], /^This study examines/);
  assert.match(passages[2], /^Results show/);
});

test("paragraph breaks are respected in both scripts", () => {
  const mixed = `${THAI_BODY}\n\nThis paragraph is written in English and is long enough to survive the minimum length filter applied by the splitter.`;
  const passages = splitTextPassages(mixed);
  assert.equal(passages.length, 2);
  assert.ok(passages.some((passage) => /[฀-๿]/.test(passage)));
  assert.ok(passages.some((passage) => /This paragraph/.test(passage)));
});

test("passages below the minimum length are dropped", () => {
  assert.deepEqual(splitTextPassages("too short"), []);
});

test("empty input yields no passages", () => {
  assert.deepEqual(splitTextPassages(""), []);
  assert.deepEqual(splitTextPassages("   "), []);
});

test("duplicate passages are collapsed", () => {
  const repeated = `${THAI_BODY}\n\n${THAI_BODY}`;
  assert.equal(splitTextPassages(repeated).length, 1);
});

test("a Thai question retrieves the Thai paper over an unrelated one", () => {
  const documents = [
    doc({
      paperId: "thai",
      title: "การใช้ภาษาอังกฤษเป็นภาษานานาชาติในห้องเรียนไทย",
      abstract: THAI_BODY,
      content: THAI_BODY,
    }),
    doc({
      paperId: "chem",
      title: "เคมีอินทรีย์ของสารประกอบคาร์บอน",
      abstract: "งานวิจัยนี้ศึกษาปฏิกิริยาเคมีอินทรีย์ของสารประกอบคาร์บอนในห้องปฏิบัติการ",
      content: "งานวิจัยนี้ศึกษาปฏิกิริยาเคมีอินทรีย์ของสารประกอบคาร์บอนในห้องปฏิบัติการ",
    }),
  ];
  const ranked = rankRepositoryEvidence(documents, ["ทัศนคติของครูต่อการสอนภาษาอังกฤษ"], 2);
  assert.ok(ranked.length > 0, "Thai query returned no candidates at all");
  assert.equal(ranked[0].paperId, "thai", "the Thai EIL paper should rank first");
});

test("an English question still retrieves the English paper", () => {
  const documents = [
    doc({
      paperId: "eil",
      title: "English as an International Language in Thai Classrooms",
      abstract: "This study examines teacher attitudes toward communicative English teaching.",
      content: "This study examines teacher attitudes toward communicative English teaching.",
    }),
    doc({
      paperId: "chem",
      title: "Organic Chemistry of Carbon Compounds",
      abstract: "This paper investigates organic reactions of carbon compounds in the laboratory.",
      content: "This paper investigates organic reactions of carbon compounds in the laboratory.",
    }),
  ];
  const ranked = rankRepositoryEvidence(documents, ["teacher attitudes toward English teaching"], 2);
  assert.ok(ranked.length > 0);
  assert.equal(ranked[0].paperId, "eil");
});

test("a Thai excerpt is quoted rather than left empty", () => {
  const documents = [
    doc({
      paperId: "thai",
      title: "การใช้ภาษาอังกฤษ",
      abstract: "",
      content: new Array(8).fill(THAI_BODY).join(" "),
    }),
  ];
  const ranked = rankRepositoryEvidence(documents, ["ผลการวิจัยพบว่าผู้เรียน"], 1);
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].excerpt.trim().length > 0, "excerpt must not be empty");
  assert.match(ranked[0].excerpt, /[฀-๿]/u);
});
