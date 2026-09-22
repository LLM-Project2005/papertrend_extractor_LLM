/**
 * Checks real answers from the live suite against the Phase 3 criteria.
 *
 * The unit tests cover the checks themselves with cases chosen to exercise
 * them. This runs the same checks over whatever the deployed system actually
 * said, which is the only way to find the shapes nobody thought to write a
 * case for - both defects fixed in Phase 3 were found this way and neither was
 * in any test beforehand.
 *
 *   npx tsx scripts/check-live-answers.ts <eval-results.json>
 *
 * Exits non-zero when any answer fails, so it can gate a release.
 */
import { readFileSync } from "node:fs";
import { leadsWithDirectAnswer, renderingIssues } from "../src/lib/answer-rendering";
import { markCitations } from "../src/lib/answer-citations";

interface EvalRecord {
  id: string;
  answer: string;
  citations?: number;
  citationList?: Array<{ paperId: string; title: string; year: string; href: string }>;
  category?: string;
}

const path = process.argv[2];
if (!path) {
  console.error("usage: check-live-answers.ts <eval-results.json>");
  process.exit(2);
}

const rows = JSON.parse(readFileSync(path, "utf8")) as EvalRecord[];
let renderFailures = 0;
let directFailures = 0;
let longest = 0;
let marked = 0;
let unmarked = 0;

for (const row of rows) {
  const answer = row.answer ?? "";
  longest = Math.max(longest, answer.length);

  const issues = renderingIssues(answer);
  if (issues.length > 0) {
    renderFailures += 1;
    for (const issue of issues) {
      console.log(`RENDER  ${row.id.padEnd(18)} ${issue.kind}/${issue.detail}: ${JSON.stringify(issue.sample)}`);
    }
  }

  const direct = leadsWithDirectAnswer(answer);
  if (!direct.ok) {
    directFailures += 1;
    console.log(`DIRECT  ${row.id.padEnd(18)} ${direct.reason}: ${JSON.stringify(direct.opening.slice(0, 90))}`);
  }

  // A citation that never becomes a marker means the reader still meets a
  // 60-character title mid-sentence. This needs the real citation objects: an
  // earlier version of this check passed an empty list and could only ever
  // report zero, which looked like a finding and was an artefact.
  if (row.citationList && row.citationList.length > 0) {
    const { text, sources } = markCitations(answer, row.citationList);
    const leftInline = text.match(/\([^()]{12,120},\s*(?:\d{4}|Unknown)\)/g) ?? [];
    if (leftInline.length > 0) {
      unmarked += 1;
      console.log(
        `CITE    ${row.id.padEnd(18)} ${leftInline.length} inline title(s) not matched to a source: ${JSON.stringify(leftInline[0].slice(0, 70))}`
      );
    }
    if (sources.length > 0) marked += 1;
  }
}

console.log("");
console.log(`answers checked           ${rows.length}`);
console.log(`longest answer            ${longest.toLocaleString()} characters`);
console.log(`rendering failures        ${renderFailures}`);
console.log(`directness failures       ${directFailures}`);
console.log(`answers with footnotes    ${marked}`);
console.log(`inline titles unmatched   ${unmarked}`);

const passed = renderFailures === 0 && directFailures === 0;
console.log("");
console.log(passed ? "PASS: every answer renders cleanly and opens with its answer" : "FAIL");
process.exit(passed ? 0 : 1);
