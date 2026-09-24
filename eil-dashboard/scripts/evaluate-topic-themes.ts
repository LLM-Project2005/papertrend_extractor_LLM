/**
 * Chooses and checks how topics are grouped, by measurement rather than guess.
 *
 * Reads a repository's dashboard payload from disk - the same `trends` the
 * dashboard receives - and scores groupings of its topics. The findings are in
 * docs/28; this reproduces them.
 *
 *   Shipped method (src/lib/topic-themes.ts):
 *     --consensus 3 [--judge] [--save-prefix P] [--from-runs a.json,b.json,c.json]
 *         three independent groupings, keeping the merges most of them make
 *     --assign 5 [--from-runs ...]
 *         holds back the last five papers, groups the rest, then files the held
 *         back papers' topics the way a new paper is filed in production
 *     --pairs a.json,b.json [--judge]
 *         re-measures saved groupings and how far they agree - free
 *
 *   Evidence for the choice:
 *     --group <model> [RUNS=n]       single groupings, and how far two agree
 *     (no flag) | --show|--judge <label|keywords|agreement> <threshold>
 *         the embedding baseline that was measured first and rejected
 *
 * Every grouping is checked without a judge against fixed pairs - topics that
 * must share a theme and look-alikes that must not - and against duplicate
 * uploads, which must land in the same themes. The judge (JUDGE_VERSION=v1|v2)
 * is one gpt-4o call per grouping, for the few groupings worth judging.
 *
 * Cost. Keys come from .env.local and are never printed; every model call prints
 * what it cost, from OpenRouter's own accounting. REASONING=low is what ships.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  addLeftoverGroups,
  assignmentMessages,
  buildNamedThemes,
  clusterBySimilarity,
  collectTopicItems,
  consensusAssignment,
  consensusGroups,
  extendGroups,
  groupingMessages,
  measureThemes,
  parseAssignment,
  parseGrouping,
  type GroupingMessage,
  type ThemeGroup,
  type TopicItem,
} from "../src/lib/topic-themes";
import type { CorpusTopicFamily, TrendRow } from "../src/types/database";

/* ------------------------------------------------------------ plumbing */

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* no local env */
  }
  return { ...out, ...(process.env as Record<string, string>) };
}

function endpoint() {
  const e = env();
  const base = (e.OPENAI_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, "");
  if (!e.OPENAI_API_KEY) throw new Error("No OPENAI_API_KEY in .env.local");
  return { base, key: e.OPENAI_API_KEY };
}

/** One chat call, with OpenRouter's own cost accounting so the spend is exact. */
async function chat(model: string, messages: GroupingMessage[]) {
  const { base, key } = endpoint();
  const started = Date.now();
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages,
      response_format: { type: "json_object" },
      usage: { include: true },
      // REASONING=low|medium limits a thinking model's hidden tokens, which are
      // billed as output and are most of the latency.
      ...(env().REASONING ? { reasoning: { effort: env().REASONING } } : {}),
    }),
  });
  if (!response.ok) throw new Error(`chat request failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  };
  return {
    text: payload.choices?.[0]?.message?.content ?? "",
    ms: Date.now() - started,
    tokensIn: payload.usage?.prompt_tokens ?? 0,
    tokensOut: payload.usage?.completion_tokens ?? 0,
    cost: payload.usage?.cost ?? NaN,
  };
}

/* ------------------------------------------------------------- the judge */

async function judge(families: CorpusTopicFamily[]) {
  const { base, key } = endpoint();
  const model = env().JUDGE_MODEL ?? "openai/gpt-4o";
  const multi = families.filter((f) => f.paperIds.length >= 2);
  const listing = multi
    .map((f, i) => `${i + 1}. Theme name: "${f.canonicalTopic}"\n   Member topics: ${f.aliases.map((a) => `"${a}"`).join("; ")}`)
    .join("\n");
  // v1 is the judge every early candidate was scored with, kept so those
  // numbers can be reproduced. It marked a theme down whenever a member was more
  // specific than the theme's name - "'Corpus-Based Thai EFL Analysis' is more
  // specific" - which every member of a real grouping is, so it could not tell
  // a good grouping from a mediocre one. v2 says so, keeps the strictness about
  // shared wording, and is trusted only because it still fails the embedding
  // grouping known to merge unlike topics (3 unrelated, 35% same).
  const v2 = (env().JUDGE_VERSION ?? "v2") === "v2";
  const prompt = v2
    ? `You are reviewing how a research dashboard grouped the topics of academic papers in applied linguistics / English language teaching.\n` +
      `Each theme is a heading on the dashboard. Its members are the topic labels individual papers were given, so a member is normally more specific than its theme - that is expected, not a fault.\n` +
      `For each theme, judge its members:\n` +
      `- "same": a researcher reading the theme name would expect every member under it, and would file each member under this theme rather than a different one\n` +
      `- "related": the members are in the same broad area, but a researcher would file at least one of them under a different heading\n` +
      `- "unrelated": at least one member is about something else entirely\n` +
      `Then rate the NAME: "good" (a fair heading for all members), "narrow" (fits only some members), or "misleading" (a reader would expect different content).\n` +
      `Be strict about shared wording: sharing words such as "assessment", "framework" or "EFL", or sharing a theory, does not make topics one theme.\n\n` +
      `${listing}\n\n` +
      `Reply with JSON only: {"verdicts":[{"theme":1,"coherence":"same|related|unrelated","name":"good|narrow|misleading","reason":"short"}]}`
    : `You are reviewing how a research dashboard grouped the topics of academic papers in applied linguistics / English language teaching.\n` +
      `For each theme below, judge whether its member topics belong to ONE coherent research theme that a researcher would recognise.\n` +
      `- "same": the members are about the same research theme\n` +
      `- "related": broadly adjacent, but a researcher would keep some apart\n` +
      `- "unrelated": at least one member clearly belongs to a different theme\n` +
      `Also rate whether the theme NAME fairly describes all its members: "good", "narrow" (names only part of it), or "misleading".\n` +
      `Be strict. Sharing the words "assessment", "framework" or "EFL" does not make two topics the same theme.\n\n` +
      `${listing}\n\n` +
      `Reply with JSON only: {"verdicts":[{"theme":1,"coherence":"same|related|unrelated","name":"good|narrow|misleading","reason":"short"}]}`;
  const response = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0, messages: [{ role: "user", content: prompt }], response_format: { type: "json_object" } }),
  });
  if (!response.ok) throw new Error(`judge request failed: ${response.status}`);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = payload.choices?.[0]?.message?.content ?? "{}";
  const verdicts = (JSON.parse(text).verdicts ?? []) as Array<{ theme: number; coherence: string; name: string; reason: string }>;
  const u = payload.usage ?? {};
  const cost = ((u.prompt_tokens ?? 0) / 1e6) * 2.5 + ((u.completion_tokens ?? 0) / 1e6) * 10;
  return { multi, verdicts, cost, model: `${model} (judge ${v2 ? "v2" : "v1"})` };
}

async function printJudgement(families: CorpusTopicFamily[]) {
  const { multi, verdicts, cost, model } = await judge(families);
  const tally = (key: "coherence" | "name", value: string) => verdicts.filter((v) => v[key] === value).length;
  console.log(`judged ${multi.length} multi-paper themes with ${model} (~$${cost.toFixed(4)})`);
  console.log(`  coherence: same ${tally("coherence", "same")}, related ${tally("coherence", "related")}, unrelated ${tally("coherence", "unrelated")}`);
  console.log(`  names    : good ${tally("name", "good")}, narrow ${tally("name", "narrow")}, misleading ${tally("name", "misleading")}`);
  const coherent = multi.length === 0 ? 1 : tally("coherence", "same") / multi.length;
  console.log(`  COHERENT (same): ${(coherent * 100).toFixed(0)}%`);
  for (const v of verdicts.filter((v) => v.coherence !== "same" || v.name !== "good")) {
    const f = multi[v.theme - 1];
    console.log(`   - #${v.theme} [${v.coherence}/${v.name}] "${f?.canonicalTopic}": ${v.reason}`);
  }
}

/* ------------------------------------------------ checks without a judge */

/**
 * Papers in the repository that are the same study uploaded twice.
 *
 * Found by title: the same content words, allowing for a subtitle or a leading
 * "The". The pipeline labelled each copy separately and gave them no topic in
 * common, so a grouping that works puts the two copies in the same themes.
 */
function duplicatePairs(trends: TrendRow[]): Array<[string, string]> {
  const stop = new Set(["a", "an", "the", "of", "on", "in", "to", "and", "for", "by", "with", "among", "its", "their"]);
  const words = new Map<string, Set<string>>();
  for (const row of trends) {
    if (words.has(row.paper_id)) continue;
    words.set(
      row.paper_id,
      new Set(
        String(row.title ?? "")
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, " ")
          .split(/\s+/)
          .filter((word) => word && !stop.has(word))
      )
    );
  }
  const ids = [...words.keys()].sort();
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = words.get(ids[i])!;
      const b = words.get(ids[j])!;
      const shared = [...a].filter((word) => b.has(word)).length;
      if (shared / Math.min(a.size, b.size) >= 0.8 && Math.min(a.size, b.size) >= 4) pairs.push([ids[i], ids[j]]);
    }
  }
  return pairs;
}

function duplicateAgreement(trends: TrendRow[], families: CorpusTopicFamily[]) {
  const themesOf = new Map<string, Set<string>>();
  for (const family of families) {
    for (const paperId of family.paperIds) themesOf.set(paperId, new Set([...(themesOf.get(paperId) ?? []), family.id]));
  }
  const scores = duplicatePairs(trends).map(([a, b]) => {
    const x = themesOf.get(a) ?? new Set<string>();
    const y = themesOf.get(b) ?? new Set<string>();
    const shared = [...x].filter((id) => y.has(id)).length;
    const union = new Set([...x, ...y]).size;
    return { shared, jaccard: union === 0 ? 0 : shared / union };
  });
  return {
    pairs: scores.length,
    sharing: scores.filter((s) => s.shared > 0).length,
    meanJaccard: scores.length === 0 ? 0 : scores.reduce((sum, s) => sum + s.jaccard, 0) / scores.length,
  };
}

/**
 * Pairs whose answer is not a matter of taste, fixed before the consensus runs
 * and never edited to fit a result. Each is two papers' labels for one focus -
 * or, for the second list, two labels that look alike and are not.
 */
const MUST_MERGE: Array<[string, string]> = [
  ["Dynamic Assessment Modalities", "Dynamic Assessment Interactional Frameworks"],
  ["Functional Spoken Discourse Markers", "Pragmatic Functions of Discourse Markers"],
  ["Brinton's Discourse Marker Functions", "Discourse Marker Pragmatic Frameworks"],
  ["Portfolio-Based Writing Assessment", "Portfolio Assessment and Error Analysis"],
  ["Blended Genre-Based Writing Instruction", "Genre-Based Blended Writing Instruction"],
  ["Genre-Based Pedagogical Instructional Stages", "SFL Genre-Based Pedagogical Framework"],
  ["SFL-Informed Genre Analysis", "Genre Analysis and Structural Features"],
  ["Morphosyntactic Processing of Relative Clauses", "Syntactic Processing and Dependency Resolution"],
  ["Argumentative Writing Assessment Methodology", "ESP Argumentative Writing Assessment Research"],
  ["Project-Based Learning Core Components", "Project-Based Learning Pedagogical Framework"],
  ["Learning-Oriented Assessment Frameworks", "Learning-Oriented and Alternative Assessment"],
  ["Academic Vocabulary Assessment and Learning", "Vocabulary Acquisition and Knowledge Building"],
  ["Mixed-Methods Educational Research Methodology", "Mixed Methods Research Design"],
  ["Psycholinguistic Experimental Processing Tasks", "Experimental Psycholinguistic Assessment Methods"],
];
const MUST_STAY_APART: Array<[string, string]> = [
  ["L2 Phonological Acquisition Processes", "L2 Morphosyntactic Acquisition Processes"],
  ["Oracy Skills Assessment Methodology", "Argumentative Writing Assessment Methodology"],
  ["English Word Stress Production", "English Irregular Verb Morphology"],
  ["Dynamic Assessment Modalities", "Portfolio-Based Writing Assessment"],
  ["Mixed Methods Research Design", "Classroom Assessment Practices"],
  ["Teacher Agency Manifestation Dynamics", "Learner-Centered Assessment and Autonomy"],
];

function fixedPairs(families: CorpusTopicFamily[]) {
  const themeOf = new Map<string, string>();
  for (const family of families) for (const alias of family.aliases) themeOf.set(alias, family.id);
  const check = (pairs: Array<[string, string]>, wantSame: boolean) => {
    const failed: string[] = [];
    for (const [a, b] of pairs) {
      const x = themeOf.get(a);
      const y = themeOf.get(b);
      if (!x || !y) failed.push(`${a} | ${b} (label missing)`);
      else if ((x === y) !== wantSame) failed.push(`${a} | ${b}`);
    }
    return { passed: pairs.length - failed.length, total: pairs.length, failed };
  };
  const merge = check(MUST_MERGE, true);
  const apart = check(MUST_STAY_APART, false);
  console.log(`   fixed pairs: merged ${merge.passed}/${merge.total}, kept apart ${apart.passed}/${apart.total}`);
  for (const f of merge.failed) console.log(`     not merged: ${f}`);
  for (const f of apart.failed) console.log(`     wrongly merged: ${f}`);
  return { merge, apart };
}

function sameThemePairs(families: CorpusTopicFamily[]): Set<string> {
  const out = new Set<string>();
  for (const family of families) {
    const labels = [...family.aliases].sort();
    for (let i = 0; i < labels.length; i += 1) {
      for (let j = i + 1; j < labels.length; j += 1) out.add(`${labels[i]}\u0001${labels[j]}`);
    }
  }
  return out;
}

function agreement(a: CorpusTopicFamily[], b: CorpusTopicFamily[]): number {
  const x = sameThemePairs(a);
  const y = sameThemePairs(b);
  const both = [...x].filter((p) => y.has(p)).length;
  return both / Math.max(1, new Set([...x, ...y]).size);
}

function report(label: string, trends: TrendRow[], families: CorpusTopicFamily[], papers: number) {
  const m = measureThemes(families, papers);
  const d = duplicateAgreement(trends, families);
  const subjects = measureThemes(families.filter((family) => family.kind !== "method"), papers);
  console.log(
    `${label}: ${m.themes} themes, single-paper themes ${(m.singletonRate * 100).toFixed(0)}% (topics in them ${(m.topicSingletonRate * 100).toFixed(0)}%), ` +
      `largest ${(m.largestThemeShare * 100).toFixed(0)}%, papers in shared themes ${(m.papersInSharedThemes * 100).toFixed(0)}%, ` +
      `duplicate copies sharing a theme ${d.sharing}/${d.pairs} (mean overlap ${d.meanJaccard.toFixed(2)})\n` +
      `   of which ${m.themes - subjects.themes} method themes; topic themes alone: ${subjects.themes}, ` +
      `singletons ${(subjects.singletonRate * 100).toFixed(0)}%, largest ${(subjects.largestThemeShare * 100).toFixed(0)}%`
  );
}

function show(families: CorpusTopicFamily[]) {
  for (const family of families) {
    if (family.aliases.length === 1 && family.paperIds.length === 1) continue;
    console.log(`  [${family.paperIds.length} papers]${family.kind === "method" ? " (method)" : ""} ${family.canonicalTopic}`);
    for (const alias of family.aliases) console.log(`        - ${alias}`);
  }
  const alone = families.filter((f) => f.aliases.length === 1 && f.paperIds.length === 1).map((f) => f.canonicalTopic);
  console.log(`  standing alone (${alone.length}): ${alone.join("; ")}`);
}

/* ------------------------------------------------ the shipped method */

async function proposals(model: string, items: TopicItem[], count: number, prefix?: string) {
  const replies = await Promise.all(Array.from({ length: count }, () => chat(model, groupingMessages(items))));
  const runs: ThemeGroup[][] = [];
  let spent = 0;
  replies.forEach((reply, i) => {
    spent += reply.cost;
    console.log(`proposal ${i + 1}: ${(reply.ms / 1000).toFixed(1)}s, ${reply.tokensIn} in / ${reply.tokensOut} out, $${reply.cost.toFixed(5)}`);
    const parsed = parseGrouping(reply.text, items);
    if (!parsed) return console.log("   unusable reply, left out");
    runs.push(parsed);
    if (prefix) writeFileSync(`${prefix}-run${i + 1}.json`, JSON.stringify(parsed, null, 1));
  });
  return { runs, spent };
}

/* ------------------------------------------------ the embedding baseline */

/**
 * Measured first and rejected (docs/28): at every threshold that grouped
 * enough, it merged unlike topics, because in one field nearly every label
 * shares its scaffolding. Kept so those numbers can be reproduced.
 */
const SCAFFOLDING_WORDS = new Set([
  "methodology", "methodologies", "method", "methods", "methodological", "framework", "frameworks",
  "process", "processes", "practice", "practices", "approach", "approaches", "research", "study", "studies",
  "analysis", "analyses", "model", "models", "principles", "perspectives", "constructs", "factors",
  "components", "stages", "cycles", "modalities", "instrumentation", "validation", "metrics", "phenomena",
  "mechanisms", "dimensions", "aspects", "issues", "and", "of", "in", "for", "the", "a", "an", "to", "on",
  "with", "among", "via",
]);

function substanceOf(label: string): string {
  const words = label.split(/\s+/).filter(Boolean);
  const kept = words.filter((word) => !SCAFFOLDING_WORDS.has(word.toLowerCase().replace(/[^a-z-]/g, "")));
  return (kept.length > 0 ? kept : words).join(" ");
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

function similarityMatrix(vectors: number[][]): number[][] {
  return vectors.map((a, i) => vectors.map((b, j) => (i === j ? 1 : cosine(a, b))));
}

async function embed(texts: string[]): Promise<number[][]> {
  const { base, key } = endpoint();
  const response = await fetch(`${base}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "openai/text-embedding-3-small", input: texts, dimensions: 256 }),
  });
  if (!response.ok) throw new Error(`embedding request failed: ${response.status}`);
  const payload = (await response.json()) as { data?: Array<{ index: number; embedding: number[] }>; usage?: { total_tokens?: number } };
  const ordered = [...(payload.data ?? [])].sort((a, b) => a.index - b.index).map((d) => d.embedding);
  if (ordered.length !== texts.length) throw new Error("embedding count mismatch");
  console.log(`embedded ${texts.length} texts, ${payload.usage?.total_tokens ?? 0} tokens`);
  return ordered;
}

/** Named after its most central label, shortest among near-ties. */
function centralName(members: number[], items: TopicItem[], sim: number[][]): string {
  if (members.length === 1) return items[members[0]].label;
  const scored = members.map((i) => ({ i, s: members.reduce((t, j) => t + (j === i ? 0 : sim[i][j]), 0) / (members.length - 1) }));
  const top = Math.max(...scored.map((e) => e.s));
  return scored
    .filter((e) => e.s >= top - 0.03)
    .map((e) => items[e.i].label)
    .sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

async function embeddingBaseline(trends: TrendRow[], items: TopicItem[], papers: number) {
  const vectors = await embed([
    ...items.map((i) => substanceOf(i.label)),
    ...items.map((i) => (i.keywords.length > 0 ? i.keywords.join(", ") : substanceOf(i.label))),
  ]);
  const labelSim = similarityMatrix(vectors.slice(0, items.length));
  const keywordSim = similarityMatrix(vectors.slice(items.length));
  const strategies: Record<string, number[][]> = {
    label: labelSim,
    keywords: keywordSim,
    agreement: labelSim.map((row, i) => row.map((v, j) => Math.min(v, keywordSim[i][j]))),
  };
  const grouped = (sim: number[][], threshold: number) =>
    buildNamedThemes(
      trends,
      items,
      clusterBySimilarity(items, sim, { threshold, totalPapers: papers }).map((members) => ({
        name: centralName(members, items, sim),
        kind: "topic" as const,
        members,
      }))
    ).families;

  const modeFlag = process.argv.includes("--show") ? "--show" : process.argv.includes("--judge") ? "--judge" : null;
  if (!modeFlag) {
    for (const [strategy, sim] of Object.entries(strategies)) {
      console.log(`\n== ${strategy}\nthreshold | themes | singleton | largest | papers in shared themes`);
      for (let t = 0.8; t >= 0.4 - 1e-9; t -= 0.04) {
        const threshold = Math.round(t * 100) / 100;
        const m = measureThemes(grouped(sim, threshold), papers);
        console.log(
          `   ${threshold.toFixed(2)}   |  ${String(m.themes).padStart(4)}  |    ${(m.singletonRate * 100).toFixed(0).padStart(3)}%   |  ${(m.largestThemeShare * 100).toFixed(0).padStart(3)}%   |   ${(m.papersInSharedThemes * 100).toFixed(0).padStart(3)}%`
        );
      }
    }
    return;
  }
  const strategy = process.argv[process.argv.indexOf(modeFlag) + 1];
  const threshold = Number(process.argv[process.argv.indexOf(modeFlag) + 2]);
  const families = grouped(strategies[strategy], threshold);
  report(`${strategy} @ ${threshold}`, trends, families, papers);
  fixedPairs(families);
  if (modeFlag === "--show") show(families);
  else await printJudgement(families);
}

/* ------------------------------------------------------------------ main */

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: evaluate-topic-themes.ts <payload.json> [mode] - see the header");
  const trends = (JSON.parse(readFileSync(file, "utf8")).data?.trends ?? []) as TrendRow[];
  const papers = new Set(trends.map((row) => row.paper_id)).size;
  const items = collectTopicItems(trends);
  console.log(`${papers} papers, ${items.length} distinct topics`);

  const flag = (name: string) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
  const model = env().TOPIC_THEMES_MODEL ?? "google/gemini-3.7-flash";
  const loadRuns = (list: string) => list.split(",").map((path) => JSON.parse(readFileSync(path, "utf8")) as ThemeGroup[]);

  if (process.argv.includes("--pairs")) {
    const files = flag("--pairs")!.split(",");
    const loaded = loadRuns(flag("--pairs")!).map((groups) => buildNamedThemes(trends, items, groups).families);
    loaded.forEach((families, i) => {
      report(files[i].split(/[\\/]/).pop()!, trends, families, papers);
      fixedPairs(families);
    });
    for (let i = 0; i < loaded.length; i += 1) {
      for (let j = i + 1; j < loaded.length; j += 1) {
        console.log(`   ${i + 1} and ${j + 1} agree on ${(agreement(loaded[i], loaded[j]) * 100).toFixed(0)}% of their pairs`);
      }
    }
    if (process.argv.includes("--judge")) for (const families of loaded) await printJudgement(families);
    return;
  }

  if (process.argv.includes("--consensus")) {
    const prefix = flag("--save-prefix");
    const { runs, spent } = flag("--from-runs")
      ? { runs: loadRuns(flag("--from-runs")!), spent: 0 }
      : await proposals(model, items, Number(flag("--consensus") ?? 3), prefix);
    const perRun = runs.map((run) => buildNamedThemes(trends, items, run).families);
    perRun.forEach((families, i) => {
      report(`proposal ${i + 1}`, trends, families, papers);
      fixedPairs(families);
    });
    const consensus = consensusGroups(runs, items, { totalPapers: papers });
    const families = buildNamedThemes(trends, items, consensus).families;
    console.log("");
    report("consensus", trends, families, papers);
    fixedPairs(families);
    show(families);
    console.log(`grouping cost: $${spent.toFixed(5)}`);
    if (prefix) writeFileSync(`${prefix}-consensus.json`, JSON.stringify(consensus, null, 1));
    if (process.argv.includes("--judge")) await printJudgement(families);
    return;
  }

  if (process.argv.includes("--assign")) {
    // The production path for a new paper, on papers the grouping never saw.
    const held = Number(flag("--assign") ?? 5);
    const paperIds = [...new Set(trends.map((row) => row.paper_id))].sort();
    const heldBack = new Set(paperIds.slice(-held));
    const before = trends.filter((row) => !heldBack.has(row.paper_id));
    const beforeItems = collectTopicItems(before);
    console.log(`grouping ${paperIds.length - held} papers (${beforeItems.length} topics), then filing ${held} held back`);
    const { runs, spent } = flag("--from-runs")
      ? { runs: loadRuns(flag("--from-runs")!), spent: 0 }
      : await proposals(model, beforeItems, 3, flag("--save-prefix"));
    const grouped = consensusGroups(runs, beforeItems, { totalPapers: paperIds.length - held });

    // Re-express the grouping over the full item list, as the store does.
    const index = new Map(items.map((item, i) => [item.key, i]));
    const groups = grouped.map((group) => ({ ...group, members: group.members.map((i) => index.get(beforeItems[i].key)!) }));
    const known = new Set(groups.flatMap((group) => group.members));
    const unknown = items.map((_, i) => i).filter((i) => !known.has(i));
    const themes = groups.map((group) => ({
      name: group.name,
      kind: group.kind,
      examples: group.members.slice(0, 3).map((i) => items[i].label),
    }));
    const replies = await Promise.all(
      Array.from({ length: 3 }, () => chat(model, assignmentMessages(themes, unknown.map((i) => items[i]))))
    );
    let assignSpent = 0;
    const votes = replies
      .map((reply) => {
        assignSpent += reply.cost;
        console.log(`filing call: ${(reply.ms / 1000).toFixed(1)}s, ${reply.tokensIn} in / ${reply.tokensOut} out, $${reply.cost.toFixed(5)}`);
        return parseAssignment(reply.text, themes.length, unknown.length);
      })
      .filter((vote): vote is Array<number | null> => Boolean(vote));
    const choices = consensusAssignment(votes, unknown.length);
    const assigned = unknown.filter((_, n) => choices[n] !== null);
    let filed = extendGroups(items, groups, assigned, choices.filter((choice) => choice !== null));
    const leftovers = unknown.filter((_, n) => choices[n] === null);
    console.log(`\n${unknown.length} new topics: ${assigned.length} filed into existing themes, ${leftovers.length} fit none`);
    unknown.forEach((i, n) => console.log(`   ${items[i].label} -> ${choices[n] === null ? "(none)" : themes[choices[n]!].name}`));
    if (leftovers.length >= 2) {
      const leftoverItems = leftovers.map((i) => items[i]);
      const grouped = await proposals(model, leftoverItems, 3);
      assignSpent += grouped.spent;
      const leftoverGroups = consensusGroups(grouped.runs, leftoverItems, { totalPapers: paperIds.length });
      filed = addLeftoverGroups(filed, leftovers, leftoverGroups);
      console.log(`   leftovers grouped among themselves: ${leftoverGroups.map((g) => `[${g.name}] ${g.members.length}`).join(", ")}`);
    } else {
      filed = extendGroups(items, filed, leftovers, leftovers.map(() => null));
    }
    const families = buildNamedThemes(trends, items, filed).families;
    report("after filing", trends, families, papers);
    fixedPairs(families);
    console.log(`grouping cost: $${spent.toFixed(5)}, filing cost: $${assignSpent.toFixed(5)} for ${held} papers`);
    return;
  }

  if (process.argv.includes("--group")) {
    const groupModel = flag("--group") ?? model;
    const runs = Number(env().RUNS ?? 1);
    let first: CorpusTopicFamily[] | null = null;
    for (let run = 1; run <= runs; run += 1) {
      const reply = await chat(groupModel, groupingMessages(items));
      console.log(`grouped with ${groupModel} in ${(reply.ms / 1000).toFixed(1)}s, ${reply.tokensIn} in / ${reply.tokensOut} out, $${reply.cost.toFixed(5)}`);
      const groups = parseGrouping(reply.text, items);
      if (!groups) throw new Error(`unusable reply: ${reply.text.slice(0, 300)}`);
      const families = buildNamedThemes(trends, items, groups).families;
      report(`run ${run}`, trends, families, papers);
      fixedPairs(families);
      if (first) console.log(`   agreement with run 1: ${(agreement(first, families) * 100).toFixed(0)}% of pairs`);
      else {
        first = families;
        show(families);
      }
    }
    if (process.argv.includes("--judge") && first) await printJudgement(first);
    return;
  }

  await embeddingBaseline(trends, items, papers);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
