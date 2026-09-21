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
function describeKind(category: string): string {
  if (category === "deterministic") {
    return "Computed directly from repository database records. It carries no inline citations "
      + "by design; judge groundedness on whether it states what it counted and its scope, not on citations.";
  }
  if (category === "honesty") {
    return "A question the repository cannot answer. A clear refusal that explains why is the correct answer and scores 5.";
  }
  if (category === "chart") {
    return "A chart request. The chart itself is returned separately, so judge the accompanying text.";
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
            `Citations returned: ${record.citations ?? 0}`,
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
  for (const record of records) {
    if (!record.answer?.trim()) {
      console.log(`${record.id.padEnd(18)} (no answer)`);
      continue;
    }
    const verdict = await judge(record, model, apiKey, baseUrl);
    if (!verdict) continue;
    rows.push({ record, verdict });
    const mean = (verdict.grounded + verdict.direct + verdict.readable + verdict.honest) / 4;
    console.log(
      `${record.id.padEnd(18)} g${verdict.grounded} d${verdict.direct} r${verdict.readable} h${verdict.honest}` +
        `  mean ${mean.toFixed(2)}  ${verdict.wouldSatisfyResearcher ? "OK " : "NO "} ${verdict.worstProblem}`
    );
  }

  if (rows.length === 0) return;
  const average = (pick: (v: Verdict) => number) =>
    rows.reduce((sum, row) => sum + pick(row.verdict), 0) / rows.length;
  console.log("\n--- averages ---");
  console.log(`grounded  ${average((v) => v.grounded).toFixed(2)}`);
  console.log(`direct    ${average((v) => v.direct).toFixed(2)}`);
  console.log(`readable  ${average((v) => v.readable).toFixed(2)}`);
  console.log(`honest    ${average((v) => v.honest).toFixed(2)}`);
  const satisfied = rows.filter((row) => row.verdict.wouldSatisfyResearcher).length;
  console.log(`would satisfy a researcher: ${satisfied}/${rows.length}`);

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
