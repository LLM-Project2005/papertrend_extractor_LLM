import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isParticipantDescriptor } from "../src/lib/participant-terms";
import { withoutParticipantTopics } from "../src/lib/corpus-topic-cache";

function read(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

test("a group of people is not a topic; what was studied about them is", () => {
  for (const phrase of [
    "Thai EFL undergraduate students",
    "L1 Thai learners",
    "native English speakers",
    "Thai freshmen",
    // Seen in testtest's leftover theme after the first filter.
    "low English proficiency young Thai learners of English",
    "ผู้เรียนภาษาอังกฤษในฐานะภาษาต่างประเทศ",
  ]) {
    assert.equal(isParticipantDescriptor(phrase), true, phrase);
  }
  for (const phrase of [
    "learner autonomy",
    "teacher agency",
    "EFL learners’ writing",
    "Years of English Study",
    "speaking anxiety",
    "perceptions of teachers",
    "ผู้เรียนเป็นศูนย์กลาง",
  ]) {
    assert.equal(isParticipantDescriptor(phrase), false, phrase);
  }
  assert.equal(isParticipantDescriptor(""), false);
  assert.equal(isParticipantDescriptor(null), false);
});

test("stored papers lose their participant topics without being analysed again", () => {
  // The rows behind testtest's 29-paper "EFL Learner Characteristics and
  // Demographics" theme.
  const rows = [
    { topic: "Thai EFL Undergraduate Students", keyword: "Thai EFL undergraduate students" },
    { topic: "Thai EFL Undergraduate Students", keyword: "L2 proficiency" },
    { topic: "Speaking Anxiety", keyword: "speaking anxiety" },
    { topic: "Speaking Anxiety", keyword: "Thai EFL learners" },
  ];
  assert.deepEqual(withoutParticipantTopics(rows), [
    // A real concept filed under a group becomes its own topic.
    { topic: "L2 proficiency", keyword: "L2 proficiency" },
    { topic: "Speaking Anxiety", keyword: "speaking anxiety" },
  ]);
});

test("every place that builds topics from keyword rows applies the rule", () => {
  const cache = read("src/lib/corpus-topic-cache.ts");
  assert.match(cache, /return withoutParticipantTopics\(\(data \?\? \[\]\) as KeywordSourceRow\[\]\);/);
  assert.match(cache, /!isParticipantDescriptor\(coerceString\(row\.concept_label\)\)/);
  const server = read("src/lib/dashboard-data-server.ts");
  assert.equal((server.match(/withoutParticipantTopics\(/g) ?? []).length, 2);
});
