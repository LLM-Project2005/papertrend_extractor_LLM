import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  THEME_STORE_VERSION,
  addLeftoverGroups,
  applyThemeStore,
  collectTopicItems,
  consensusAssignment,
  consensusGroups,
  extendGroups,
  groupsFromStore,
  parseAssignment,
  parseGrouping,
  planThemeUpdate,
  readThemeStore,
  storeFromGroups,
  type ThemeGroup,
  type ThemeStore,
} from "../src/lib/topic-themes";
import type { TrendRow } from "../src/types/database";

function read(relative: string): string {
  return readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
}

function row(paper: string, topic: string, keyword = "k", extra: Partial<TrendRow> = {}): TrendRow {
  return {
    paper_id: paper,
    year: "2024",
    title: `Paper ${paper}`,
    topic,
    keyword,
    keyword_frequency: 1,
    evidence: "",
    ...extra,
  } as TrendRow;
}

/** Six topics over four papers; alphabetical order is the item order. */
const TRENDS: TrendRow[] = [
  row("1", "Dynamic Assessment Modalities", "mediation"),
  row("2", "Dynamic Assessment Interactional Frameworks", "ZPD"),
  row("3", "L2 Phonological Acquisition Processes", "L1 transfer"),
  row("4", "L2 Morphosyntactic Acquisition Processes", "L1 transfer"),
  row("1", "Mixed Methods Research Design", "questionnaire"),
  row("2", "mixed methods research design", "interview"),
];
const ITEMS = collectTopicItems(TRENDS);
const at = (label: string) => ITEMS.findIndex((item) => item.label.toLowerCase() === label.toLowerCase());

function store(themes: ThemeStore["themes"], assignments: Record<string, number>, extra: Partial<ThemeStore> = {}): ThemeStore {
  return {
    version: THEME_STORE_VERSION,
    themes,
    assignments,
    groupedAt: "2026-09-24T00:00:00.000Z",
    fullGroupingTopics: 5,
    ...extra,
  };
}

/* -------------------------------------------------------------- the items */

test("a topic is one item whatever its casing, and keeps its papers", () => {
  const mixed = ITEMS[at("Mixed Methods Research Design")];
  assert.equal(ITEMS.length, 5);
  assert.deepEqual([...mixed.paperIds].sort(), ["1", "2"]);
  assert.deepEqual(mixed.keywords.sort(), ["interview", "questionnaire"]);
});

test("grouping reads the paper's own label, so grouping twice cannot compound", () => {
  const themed = [row("9", "Some Theme", "k", { raw_topic: "Original Label" })];
  assert.equal(collectTopicItems(themed)[0].label, "Original Label");
});

/* ------------------------------------------------ reading a model's reply */

test("a grouping reply becomes a valid partition, whatever the model did", () => {
  const da1 = at("Dynamic Assessment Modalities") + 1;
  const da2 = at("Dynamic Assessment Interactional Frameworks") + 1;
  const mm = at("Mixed Methods Research Design") + 1;
  const reply = "```json\n" + JSON.stringify({
    themes: [
      { name: "Dynamic Assessment", kind: "topic", topics: [da1, da2, da1, 99] },
      { name: "Research Design", kind: "method", topics: [mm, da2] },
    ],
  }) + "\n```";
  const groups = parseGrouping(reply, ITEMS)!;
  const da = groups.find((g) => g.name === "Dynamic Assessment")!;
  assert.deepEqual(da.members.sort(), [da1 - 1, da2 - 1].sort(), "a repeat and an unknown number are ignored");
  const design = groups.find((g) => g.members.includes(mm - 1))!;
  assert.equal(design.kind, "method");
  assert.equal(design.members.length, 1, "a topic already placed keeps its first theme");
  assert.equal(design.name, "Mixed Methods Research Design", "a one-topic theme keeps the paper's own label");
  const placed = groups.flatMap((g) => g.members).sort();
  assert.deepEqual(placed, ITEMS.map((_, i) => i), "a forgotten topic stands alone rather than vanishing");
});

test("two themes with one name are one theme, because the charts draw them as one", () => {
  const groups = parseGrouping(
    JSON.stringify({ themes: [{ name: "Acquisition", topics: [1, 2] }, { name: " acquisition ", topics: [3, 4] }] }),
    ITEMS
  )!;
  assert.equal(groups.filter((g) => g.name.toLowerCase().trim() === "acquisition").length, 1);
});

test("a reply that places under half the topics is a failure, not something to patch", () => {
  assert.equal(parseGrouping(JSON.stringify({ themes: [{ name: "X", topics: [1, 2] }] }), ITEMS), null);
  assert.equal(parseGrouping("not json", ITEMS), null);
  assert.equal(parseGrouping(null, ITEMS), null);
});

/* ------------------------------------------------------------ consensus */

test("a merge survives only when most groupings make it", () => {
  const da = [at("Dynamic Assessment Modalities"), at("Dynamic Assessment Interactional Frameworks")];
  const l2 = [at("L2 Phonological Acquisition Processes"), at("L2 Morphosyntactic Acquisition Processes")];
  const rest = ITEMS.map((_, i) => i).filter((i) => !da.includes(i) && !l2.includes(i));
  const alone = (indices: number[]): ThemeGroup[] => indices.map((i) => ({ name: ITEMS[i].label, kind: "topic", members: [i] }));
  const runs: ThemeGroup[][] = [
    [{ name: "Dynamic Assessment", kind: "topic", members: da }, { name: "L2 Acquisition", kind: "topic", members: l2 }, ...alone(rest)],
    [{ name: "Dynamic Assessment", kind: "topic", members: da }, ...alone([...l2, ...rest])],
    [...alone([...da, ...l2, ...rest])],
  ];
  const groups = consensusGroups(runs, ITEMS, { totalPapers: 4, maxThemeShare: 1 });
  const together = (a: number, b: number) => groups.some((g) => g.members.includes(a) && g.members.includes(b));
  assert.equal(together(da[0], da[1]), true, "two of three agree");
  assert.equal(together(l2[0], l2[1]), false, "one of three is chance, not agreement");
  assert.equal(groups.find((g) => g.members.includes(da[0]))!.name, "Dynamic Assessment");
});

test("no two consensus themes share a name", () => {
  // One run lumps four topics under one name; the consensus splits them in two,
  // and both halves match that run's theme best.
  const four = [0, 1, 2, 3];
  const runs: ThemeGroup[][] = [
    [{ name: "Everything", kind: "topic", members: four }, { name: ITEMS[4].label, kind: "topic", members: [4] }],
    [{ name: "A", kind: "topic", members: [0, 1] }, { name: "B", kind: "topic", members: [2, 3] }, { name: ITEMS[4].label, kind: "topic", members: [4] }],
    [{ name: "A2", kind: "topic", members: [0, 1] }, { name: "B2", kind: "topic", members: [2, 3] }, { name: ITEMS[4].label, kind: "topic", members: [4] }],
  ];
  const groups = consensusGroups(runs, ITEMS, { totalPapers: 4, maxThemeShare: 1 });
  const names = groups.map((g) => g.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

/* ------------------------------------------------------ filing new topics */

test("a filing reply is read per topic, and nonsense becomes 'no theme'", () => {
  const reply = JSON.stringify({
    assignments: [
      { topic: "N1", theme: 2 },
      { topic: "N2", theme: null },
      { topic: "N3", theme: 42 },
      { topic: "N9", theme: 1 },
    ],
  });
  assert.deepEqual(parseAssignment(reply, 3, 3), [1, null, null]);
  assert.equal(parseAssignment("{}", 3, 3), null);
});

test("a new topic joins a theme only when most replies chose that theme", () => {
  assert.deepEqual(consensusAssignment([[0, 1, null], [0, 2, null], [1, 1, 2]], 3), [0, 1, null]);
  assert.deepEqual(consensusAssignment([[0], [1]], 1), [null], "with two replies, both must agree");
});

test("filing puts a topic in its chosen theme, alone, or with the theme it is named after", () => {
  const groups: ThemeGroup[] = [{ name: "L2 Phonological Acquisition Processes", kind: "topic", members: [] }, { name: "Other", kind: "topic", members: [] }];
  const phon = at("L2 Phonological Acquisition Processes");
  const morph = at("L2 Morphosyntactic Acquisition Processes");
  const mixed = at("Mixed Methods Research Design");
  const next = extendGroups(ITEMS, groups, [phon, morph, mixed], [null, 1, null]);
  assert.deepEqual(next[0].members, [phon], "named like a theme, so it joins without asking");
  assert.deepEqual(next[1].members, [morph]);
  assert.ok(next.some((g) => g.name === "Mixed Methods Research Design" && g.members[0] === mixed));
});

test("new topics that fit no theme can still form one together", () => {
  const groups: ThemeGroup[] = [{ name: "Existing", kind: "topic", members: [0] }];
  const next = addLeftoverGroups(groups, [3, 4], [
    { name: "Global Englishes", kind: "topic", members: [0, 1] },
    { name: "existing", kind: "topic", members: [] },
  ]);
  assert.deepEqual(next.find((g) => g.name === "Global Englishes")!.members, [3, 4], "indices map back to the repository's topics");
  assert.equal(next.length, 2);
});

/* --------------------------------------------------------------- the store */

test("the job regroups whole when it should, and files new topics otherwise", () => {
  assert.equal(planThemeUpdate([], null), "none");
  assert.equal(planThemeUpdate(ITEMS, null), "full", "nothing stored yet");
  const all = Object.fromEntries(ITEMS.map((item) => [item.key, 0]));
  assert.equal(planThemeUpdate(ITEMS, store([{ name: "T", kind: "topic" }], all)), "none");
  const missingOne = { ...all };
  delete missingOne[ITEMS[0].key];
  assert.equal(planThemeUpdate(ITEMS, store([{ name: "T", kind: "topic" }], missingOne)), "incremental");
  assert.equal(
    planThemeUpdate(ITEMS, store([{ name: "T", kind: "topic" }], missingOne, { fullGroupingTopics: 4 })),
    "full",
    "grown by a quarter since the last whole grouping"
  );
});

test("many unseen topics regroup the repository instead of being filed one by one", () => {
  const trends = Array.from({ length: 30 }, (_, i) => row(String(i), `Topic ${i}`));
  const items = collectTopicItems(trends);
  const known = Object.fromEntries(items.slice(0, 15).map((item) => [item.key, 0]));
  assert.equal(planThemeUpdate(items, store([{ name: "T", kind: "topic" }], known, { fullGroupingTopics: 29 })), "full");
});

test("a store from another version is ignored rather than misread", () => {
  assert.equal(readThemeStore({ version: 999, themes: [], assignments: {} }), null);
  assert.equal(readThemeStore(null), null);
  const read = readThemeStore({ version: THEME_STORE_VERSION, themes: [{ name: "A" }], assignments: { a: 0 } })!;
  assert.equal(read.failures, 0);
  assert.equal(read.themes[0].kind, "topic");
});

test("a stored grouping round-trips, and drops themes that lost every topic", () => {
  const groups: ThemeGroup[] = [
    { name: "Dynamic Assessment", kind: "topic", members: [at("Dynamic Assessment Modalities"), at("Dynamic Assessment Interactional Frameworks")] },
    { name: "Empty", kind: "topic", members: [] },
  ];
  const saved = storeFromGroups(ITEMS, groups, { now: "t", fullGroupingTopics: 5 });
  assert.equal(saved.themes.length, 1);
  const { groups: back, unknown } = groupsFromStore(ITEMS, saved);
  assert.deepEqual(back[0].members.sort(), groups[0].members.sort());
  assert.equal(unknown.length, 3);
});

/* ---------------------------------------------------------------- the read */

test("a read rewrites each row to its theme and keeps the paper's own label", () => {
  const saved = storeFromGroups(
    ITEMS,
    [{ name: "Dynamic Assessment", kind: "topic", members: [at("Dynamic Assessment Modalities"), at("Dynamic Assessment Interactional Frameworks")] }],
    { now: "t", fullGroupingTopics: 5 }
  );
  const applied = applyThemeStore(TRENDS, saved);
  const da = applied.trends.filter((r) => r.topic === "Dynamic Assessment");
  assert.equal(da.length, 2);
  assert.deepEqual(da.map((r) => r.raw_topic).sort(), ["Dynamic Assessment Interactional Frameworks", "Dynamic Assessment Modalities"]);
  assert.equal(applied.unknownTopics, 3, "topics the store has not seen are counted");
  const family = applied.families.find((f) => f.canonicalTopic === "Dynamic Assessment")!;
  assert.deepEqual(family.paperIds.sort(), ["1", "2"]);
  // Applying again to rows already themed changes nothing.
  assert.deepEqual(applyThemeStore(applied.trends, saved).trends.map((r) => r.topic), applied.trends.map((r) => r.topic));
});

test("without a store, every paper's own topic is shown", () => {
  const applied = applyThemeStore(TRENDS, null);
  assert.equal(applied.unknownTopics, ITEMS.length);
  assert.deepEqual(new Set(applied.trends.map((r) => r.topic.toLowerCase())), new Set(ITEMS.map((i) => i.key)));
});

/* ------------------------------------------------------------- contracts */

test("the dashboard applies stored themes on Cloud SQL and never caches a pending read", () => {
  const server = read("src/lib/dashboard-data-server.ts");
  assert.match(server, /const themed = await applyStoredThemes\(\s*ownerUserId,\s*projectId,/);
  assert.match(server, /if \(data\.topicThemes\?\.status !== "pending"\) \{\s*dashboardServerCache\.set/);
});

test("a dashboard read never calls a model", () => {
  const service = read("src/lib/topic-theme-service.ts");
  const readPath = service.slice(service.indexOf("export async function applyStoredThemes"), service.indexOf("/* ------------------------------------------------------------ grouping */"));
  assert.equal(/ask\(|createChatCompletion/.test(readPath), false);
});

test("the grouping request trusts only the signed-in owner, and checks the repository is theirs", () => {
  const route = read("src/app/api/workspace/topic-themes/route.ts");
  assert.match(route, /const BodySchema = z\.object\(\{ projectId: z\.string\(\)\.uuid\(\) \}\);/, "no owner in the body");
  assert.match(route, /projectBelongsTo\(user\.id, projectId\)/);
  assert.match(route, /groupProjectThemes\(user\.id, projectId/);
});

test("nothing about a failed grouping invites a retry loop", () => {
  // The production task queue retries up to a hundred times with almost no
  // backoff; the grouping must not go through it, and must not answer 5xx.
  const route = read("src/app/api/workspace/topic-themes/route.ts");
  assert.equal(/status: 5\d\d/.test(route), false);
  const service = read("src/lib/topic-theme-service.ts");
  assert.equal(/cloudtasks\.googleapis\.com/.test(service), false);
  assert.match(service, /FIRST_BACKOFF_MS \* 2 \*\* Math\.max\(0, failures - 1\)/);
  assert.match(service, /WHERE workspace_analytics_cache\.payload->>'pendingSince' IS NULL/, "the claim is one statement");
});

test("grouping runs with the settings it was evaluated with", () => {
  const service = read("src/lib/topic-theme-service.ts");
  assert.match(service, /reasoningEffort: "low"/);
  assert.match(service, /if \(runs\.length < 2\) return null;/, "one grouping is not a consensus");
});

test("the dashboard asks for grouping once per repository and stops asking", () => {
  const hook = read("src/hooks/useData.ts");
  const request = hook.slice(hook.indexOf("function requestThemeGrouping"), hook.indexOf("function buildEmptyLiveData"));
  assert.equal(/signal:/.test(request), false, "a started grouping is not abandoned on navigation");
  assert.match(hook, /groupingAttemptsRef\.current >= THEME_GROUPING_MAX_ATTEMPTS/);
});
