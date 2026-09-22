/**
 * Grades saved live chat answers with a language model acting as judge.
 *
 * Precision was measured by the live suite; this measures whether the answers
 * are actually good to read: grounded, direct, readable and honest about what
 * they do not know.
 *
 *   OPENAI_API_KEY=... npx tsx scripts/judge-chat-answers.ts <results.json>
 */
import { readFileSync } from "node:fs";

interface EvalRecord {
  id: string;
  category: string;
  prompt: string;
  expectation: string;
  operation?: string | null;
  citations?: number;
  limitations?: string[];
  answer: string;
}

interface Verdict {
  grounded: number;
  direct: number;
  readable: number;
  honest: number;
  worstProblem: string;
  wouldSatisfyResearcher: boolean;
}

const CRITERIA = `Score each dimension 1-5, where 3 is acceptable and 5 is excellent.

grounded: every substantive claim traces to the cited papers. Invented findings,
  numbers or papers score 1. Refusing to answer when evidence is absent is
  correct and scores 5.
direct: the first sentence answers the question that was asked. Preamble,
  restating the question, or answering a different question lowers this.
readable: a researcher can scan it. Helpful headings, short paragraphs, tables
  where tabular, no wall of text, no leaked JSON or markup, no repetition.
honest: states coverage and gaps plainly. Claims of completeness it cannot
  support score 1. Naming what is missing scores 5.
worstProblem: one short sentence naming the single biggest flaw, or "none".
wouldSatisfyResearcher: true only if a researcher would accept this as an answer.`;

/**
 * Tells the judge how groundedness should be read for this kind of answer.
 *
 * Counts, year breakdowns and length rankings are computed directly from the
 * stored repository, so they carry no inline citations by design. Judging them
 * as if they were unsupported claims measures the harness, not the product.
 */
/**
 * Counts citations as they actually appear to a reader.
 *
 * Answers are rendered before display, so `[Paper 12]` markers have already
 * become "(Title, Year)". Trusting the API's citation array instead made the
 * judge report "no citations" for answers carrying a dozen of them.
 */
function countInlineCitations(answer: string): number {
  const markers = answer.match(/\[Paper\s+[^\]]+\]/gi)?.length ?? 0;
  const rendered = answer.match(/\([^()]{12,120}?,\s*(?:\d{4}|Unknown)\)/g)?.length ?? 0;
  const titleOnly = answer.match(/\([A-Z฀-๿][^()]{14,120}…\)/g)?.length ?? 0;
  return markers + rendered + titleOnly;
}

function describeKind(category: string): string {
  if (category === "deterministic") {
    return "Computed directly from repository database records. It carries no inline citations "
      + "by design; judge groundedness on whether it states what it counted and its scope, not on citations.";
  }
  if (category === "honesty") {
    return "A question the repository cannot answer. A clear refusal that explains why is the correct answer and scores 5.";
  }
  if (category === "chart") {
    // The figures in a chart answer come from the same repository records the
    // deterministic answers are computed from, so they carry no inline
    // citations either. Without saying so the judge scored an accurate,
    // well-formed topic breakdown 1.0 for groundedness while scoring the
    // identical kind of answer 4.0 when it happened to be labelled
    // deterministic - the same answer judged by two standards.
    return "A chart request. The chart itself is returned separately, so judge the accompanying text. "
      + "Its figures are computed directly from repository database records and carry no inline "
      + "citations by design; judge groundedness on whether the text states what was counted and over "
      + "what scope, not on citations.";
  }
  return "A synthesis over paper evidence. Substantive claims should be attributed to specific papers.";
}

async function judge(record: EvalRecord, model: string, apiKey: string, baseUrl: string): Promise<Verdict | null> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "You grade answers produced by a research-paper assistant. Be a strict, fair reviewer. " +
            "You cannot see the source papers, so judge groundedness by whether claims are attributed and hedged " +
            "appropriately, not by whether they are factually true. Return JSON only.\n\n" +
            CRITERIA,
        },
        {
          role: "user",
          content: [
            `Question asked: ${record.prompt}`,
            `Answer kind: ${describeKind(record.category)}`,
            `What a good answer must do: ${record.expectation}`,
            `Inline citations found in the answer: ${countInlineCitations(record.answer)}`,
            `Limitations reported: ${(record.limitations ?? []).join(" | ") || "none"}`,
            "",
            "# Answer",
            record.answer.slice(0, 12_000),
          ].join("\n"),
        },
      ],
    }),
  });
  if (!response.ok) {
    console.error(`  judge failed (${response.status}) for ${record.id}`);
    return null;
  }
  const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = payload.choices?.[0]?.message?.content ?? "";
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(content.slice(start, end + 1)) as Verdict;
  } catch {
    return null;
  }
}

/** Judge passes averaged per answer. More passes, less noise, more cost. */
const JUDGE_PASSES = Math.max(1, Number.parseInt(process.env.JUDGE_PASSES ?? "3", 10) || 3);

/**
 * How close to a threshold a first pass has to be before it is worth re-judging.
 *
 * The criteria are averages of 4.5 and a floor of 4.0. A score of 5.0 will not
 * average below either, and a score of 2.0 will not climb above them; neither
 * is in doubt and neither needs a second opinion. A score between 3.5 and 4.7
 * might land on either side, and that is where the noise actually costs a wrong
 * conclusion.
 */
const DOUBT_LOW = 3.5;
const DOUBT_HIGH = 4.7;

function nearThreshold(verdict: Verdict): boolean {
  return [verdict.readable, verdict.direct, verdict.grounded, verdict.honest].some(
    (score) => score >= DOUBT_LOW && score <= DOUBT_HIGH
  );
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: tsx scripts/judge-chat-answers.ts <eval-results.json>");
    process.exit(1);
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY is required.");
    process.exit(1);
  }
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const model = process.env.JUDGE_MODEL ?? "openai/gpt-4o";
  const records = JSON.parse(readFileSync(file, "utf8")) as EvalRecord[];

  console.log(`Judging ${records.length} answers with ${model}\n`);
  const rows: Array<{ record: EvalRecord; verdict: Verdict }> = [];
  let callsSpent = 0;
  for (const record of records) {
    if (!record.answer?.trim()) {
      console.log(`${record.id.padEnd(18)} (no answer)`);
      continue;
    }
    // A single pass is not repeatable enough to check a threshold: the same
    // answers scored 3.43, 3.81, 3.76 and 3.62 on groundedness across runs.
    // Averaging several passes separates a real change from judge noise.
    //
    // But noise only matters near a threshold. An answer scoring 5.0 on a pass
    // is not going to average below 4.5, and paying for two more passes to
    // confirm it buys nothing. So every answer gets one pass, and only the ones
    // close enough to the line to be in doubt get the rest. Measured on this
    // suite it spent 53 calls where three flat passes would have spent 63, and
    // the whole run - 21 answers and 53 judge calls - cost $0.25. The saving is
    // real but modest, because most answers on this suite genuinely do land
    // between 4.0 and 4.5, which is exactly where the re-judging is warranted.
    const passes: Verdict[] = [];
    const first = await judge(record, model, apiKey, baseUrl);
    callsSpent += 1;
    if (first) passes.push(first);
    if (first && JUDGE_PASSES > 1 && nearThreshold(first)) {
      for (let attempt = 1; attempt < JUDGE_PASSES; attempt += 1) {
        const extra = await judge(record, model, apiKey, baseUrl);
        callsSpent += 1;
        if (extra) passes.push(extra);
      }
    }
    if (passes.length === 0) continue;
    const mean = (pick: (v: Verdict) => number) =>
      passes.reduce((sum, v) => sum + pick(v), 0) / passes.length;
    const verdict: Verdict = {
      grounded: mean((v) => v.grounded),
      direct: mean((v) => v.direct),
      readable: mean((v) => v.readable),
      honest: mean((v) => v.honest),
      worstProblem: passes[0].worstProblem,
      wouldSatisfyResearcher:
        passes.filter((v) => v.wouldSatisfyResearcher).length > passes.length / 2,
    };
    rows.push({ record, verdict });
    const overall = (verdict.grounded + verdict.direct + verdict.readable + verdict.honest) / 4;
    console.log(
      `${record.id.padEnd(18)} g${verdict.grounded.toFixed(1)} d${verdict.direct.toFixed(1)} ` +
        `r${verdict.readable.toFixed(1)} h${verdict.honest.toFixed(1)}` +
        `  mean ${overall.toFixed(2)}  ${verdict.wouldSatisfyResearcher ? "OK " : "NO "} ${verdict.worstProblem}`
    );
  }

  if (rows.length === 0) return;
  const average = (pick: (v: Verdict) => number) =>
    rows.reduce((sum, row) => sum + pick(row.verdict), 0) / rows.length;
  console.log(`
model calls spent: ${callsSpent} (one per answer, plus re-judging only where a score sat near a threshold)`);
  console.log("\n--- averages ---");
  console.log(`grounded  ${average((v) => v.grounded).toFixed(2)}`);
  console.log(`direct    ${average((v) => v.direct).toFixed(2)}`);
  console.log(`readable  ${average((v) => v.readable).toFixed(2)}`);
  console.log(`honest    ${average((v) => v.honest).toFixed(2)}`);
  const satisfied = rows.filter((row) => row.verdict.wouldSatisfyResearcher).length;
  console.log(`would satisfy a researcher: ${satisfied}/${rows.length}`);

  // The Phase 3 gate, reported rather than eyeballed from the rows. The
  // "no case below 4" clause is the one that is easy to miss by scanning: an
  // average of 4.78 can still hide a single answer at 3.0.
  const minReadable = Math.min(...rows.map((row) => row.verdict.readable));
  const worstReadable = rows.find((row) => row.verdict.readable === minReadable);
  const readableAverage = average((v) => v.readable);
  const directAverage = average((v) => v.direct);
  const checks: Array<[string, boolean, string]> = [
    ["readable average >= 4.5", readableAverage >= 4.5, readableAverage.toFixed(2)],
    ["direct average >= 4.5", directAverage >= 4.5, directAverage.toFixed(2)],
    [
      "no readable case below 4",
      minReadable >= 4,
      `lowest ${minReadable.toFixed(1)} (${worstReadable?.record.id ?? "n/a"})`,
    ],
  ];
  console.log("\n--- phase 3 criteria ---");
  for (const [label, ok, detail] of checks) {
    console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(26)} ${detail}`);
  }

  const weakest = [...rows]
    .sort(
      (a, b) =>
        a.verdict.grounded + a.verdict.direct + a.verdict.readable + a.verdict.honest -
        (b.verdict.grounded + b.verdict.direct + b.verdict.readable + b.verdict.honest)
    )
    .slice(0, 5);
  console.log("\n--- weakest answers ---");
  for (const row of weakest) {
    console.log(`${row.record.id}: ${row.verdict.worstProblem}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
