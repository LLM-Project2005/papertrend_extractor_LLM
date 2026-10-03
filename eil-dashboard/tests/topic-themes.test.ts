import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createElement, Fragment } from "react";
import {
  THEME_STORE_VERSION,
  addLeftoverGroups,
  applyThemeStore,
  collectTopicItems,
  consensusAssignment,
  consensusGroups,
  extendGroups,
  groupingMessages,
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
import { paperIdFromRunId } from "../src/lib/paper-id";
import { createGeneralAnalysisProfile } from "../src/lib/project-analysis-profile";
import { routeHarness, stubModule } from "./support/route-harness";
import type { ChatAnswerModel, ChatAnswerModelCall } from "./support/stub-chatanswer-openai";
import { headlessRoot } from "./support/stub-smallfix-root";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/src/lib/openai.ts", support("stub-chatanswer-openai.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));

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

test("a theme the groupings agree on is not split for being large", () => {
  // Seven papers under one label and two under another, merged by every run: a
  // share cap made them two bars with nearly one name.
  const trends = [
    ...Array.from({ length: 7 }, (_, i) => row(`big${i}`, "Structured Peer Feedback Interventions")),
    row("s1", "structured peer feedback"),
    row("s2", "structured peer feedback"),
    ...Array.from({ length: 12 }, (_, i) => row(`o${i}`, `Other topic ${i}`)),
  ];
  const items = collectTopicItems(trends);
  const big = items.findIndex((item) => item.key === "structured peer feedback interventions");
  const small = items.findIndex((item) => item.key === "structured peer feedback");
  const rest = items.map((_, i) => i).filter((i) => i !== big && i !== small);
  const run: ThemeGroup[] = [
    { name: "Structured Peer Feedback", kind: "topic", members: [big, small] },
    ...rest.map((i) => ({ name: items[i].label, kind: "topic" as const, members: [i] })),
  ];
  const groups = consensusGroups([run, run, run], items, { totalPapers: 21 });
  assert.ok(groups.some((g) => g.members.includes(big) && g.members.includes(small)));
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

/*
 * The read, the grouping request and the dashboard's asking, run against
 * PGlite under the app's role (tests/support/route-harness.ts). The model is
 * stub-chatanswer-openai.ts, which records each call and answers from the
 * test's script; the dashboard hook runs its effects through React's client
 * renderer without a document (stub-smallfix-root.ts), signed in by
 * stub-auditfix-auth.ts.
 */

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000a9";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const runOf = (n: number) => `${n.toString(16).padStart(8, "0")}-e5f6-4a7b-8c9d-0e1f2a3b4c5d`;
const GROUPED = JSON.stringify({ themes: [{ name: "Assessment", kind: "topic", topics: [1, 2, 3] }] });

/** Calls made of the model, and what it answers each. */
function model(reply: (call: ChatAnswerModelCall) => unknown) {
  const script: ChatAnswerModel = { calls: [], reply };
  globalThis.__chatAnswerModel = script;
  return script;
}

async function repository() {
  const harness = await routeHarness({ OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: undefined, TOPIC_THEMES_MODEL: undefined });
  model(() => null);
  const owner = await harness.signIn(OWNER);
  await harness.signIn(OTHER);
  const profile = createGeneralAnalysisProfile();
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org'), ('00000000-0000-4000-8000-0000000000c9', '${OTHER}', 'Org');
  `);
  for (const [id, who] of [[PROJECT, OWNER], [OTHER_PROJECT, OTHER]]) {
    await harness.db.query(
      `INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
       VALUES ($1, $2, $3, 'Mine', $4::jsonb, $5, $6, now())`,
      [id, who === OWNER ? "00000000-0000-4000-8000-0000000000c1" : "00000000-0000-4000-8000-0000000000c9", who, JSON.stringify(profile), profile.version, profile.profileHash]
    );
  }
  await harness.db.query(`INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ($1, $2, 'A', $3)`, [FOLDER, OWNER, PROJECT]);
  /** A finished paper with these topics. */
  const paper = async (n: number, topics: string[]) => {
    const run = runOf(n);
    const id = paperIdFromRunId(run);
    await harness.db.query(`INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status) VALUES ($1, $2, $3, 'upload', 'succeeded')`, [run, OWNER, FOLDER]);
    await harness.db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2021', $4)`, [id, OWNER, FOLDER, `Paper ${n}`]);
    await harness.db.query(`INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id) VALUES ($1, $2, $3, $4)`, [id, OWNER, FOLDER, run]);
    for (const topic of topics) {
      await harness.db.query(`INSERT INTO paper_keywords (paper_id, owner_user_id, folder_id, topic, keyword) VALUES ($1, $2, $3, $4, 'k')`, [id, OWNER, FOLDER, topic]);
    }
  };
  /** The grouping request, as the signed-in owner unless told otherwise. */
  const group = async (body: unknown, headers: Record<string, string> = owner) => {
    const { POST } = await import("../src/app/api/workspace/topic-themes/route");
    const response = await POST(harness.request("/api/workspace/topic-themes", { headers, body }));
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  /** Every stored grouping, by owner. */
  const stores = async () =>
    (await harness.db.query<{ owner_user_id: string; scope_key: string; payload: ThemeStore & { pendingSince?: string | null } }>(
      `SELECT owner_user_id, scope_key, payload FROM workspace_analytics_cache WHERE scope_type = 'custom' ORDER BY owner_user_id`
    )).rows;
  return { ...harness, paper, group, stores };
}

const quietly = async <T,>(work: () => Promise<T>) => {
  const muted = ["error", "info", "warn"].map((level) => mock.method(console, level as "error", () => undefined));
  try {
    return await work();
  } finally {
    for (const method of muted) method.mock.restore();
  }
};

test("the dashboard applies stored themes on Cloud SQL, never calls a model, and never caches a pending read", async () => {
  const { db, paper } = await repository();
  const script = model(() => GROUPED);
  await paper(1, ["Dynamic Assessment Modalities"]);
  await paper(2, ["Dynamic Assessment Interactional Frameworks"]);
  const { loadDashboardDataServer } = await import("../src/lib/dashboard-data-server");
  const read = () => quietly(() => loadDashboardDataServer(OWNER, [], PROJECT, "live"));

  const pending = await read();
  assert.equal(pending.topicThemes?.status, "pending", "two topics no grouping has seen");
  assert.deepEqual(pending.trends.map((row) => row.topic).sort(), ["Dynamic Assessment Interactional Frameworks", "Dynamic Assessment Modalities"]);

  // A grouping arrives; the next read is not handed the pending one back.
  await db.query(
    `INSERT INTO workspace_analytics_cache (owner_user_id, scope_type, scope_key, version_hash, payload) VALUES ($1, 'custom', $2, 'themes', $3::jsonb)`,
    [OWNER, `topic-themes:v${THEME_STORE_VERSION}:${PROJECT}`, JSON.stringify(store([{ name: "Dynamic Assessment", kind: "topic" }], { "dynamic assessment modalities": 0, "dynamic assessment interactional frameworks": 0 }, { fullGroupingTopics: 2 }))]
  );
  const ready = await read();
  assert.equal(ready.topicThemes?.status, "ready");
  assert.deepEqual(ready.trends.map((row) => row.topic), ["Dynamic Assessment", "Dynamic Assessment"]);
  assert.deepEqual(ready.trends.map((row) => row.raw_topic).sort(), ["Dynamic Assessment Interactional Frameworks", "Dynamic Assessment Modalities"]);

  // A ready read is kept, so the pending one above was left out on purpose.
  await paper(3, ["Washback"]);
  assert.equal((await read()).trends.length, 2, "served from the cache");
  assert.equal(script.calls.length, 0, "no read called a model");
});

test("the grouping request trusts only the signed-in owner, and checks the repository is theirs", async () => {
  const { paper, group, stores, request } = await repository();
  const script = model(() => GROUPED);
  await paper(1, ["Dynamic Assessment Modalities"]);
  await paper(2, ["Dynamic Assessment Interactional Frameworks"]);
  await paper(3, ["Washback"]);
  const { POST } = await import("../src/app/api/workspace/topic-themes/route");
  assert.equal((await POST(request("/api/workspace/topic-themes", { body: { projectId: PROJECT } }))).status, 401);
  assert.equal((await group({ projectId: "not-a-repository" })).status, 400);
  assert.deepEqual(await group({ projectId: OTHER_PROJECT }), { status: 404, body: { error: "Repository not found." } }, "someone else's repository");
  assert.equal(script.calls.length, 0);

  const grouped = await quietly(() => group({ projectId: PROJECT, ownerUserId: OTHER }));
  assert.deepEqual(grouped, { status: 200, body: { status: "grouped", plan: "full", topics: 3, themes: grouped.body.themes } });
  assert.ok(Number(grouped.body.themes) >= 1);
  assert.deepEqual((await stores()).map((row) => row.owner_user_id), [OWNER], "stored for the signed-in owner, whatever the body says");
});

test("nothing about a failed grouping invites a retry loop", async () => {
  // The production task queue retries up to a hundred times with almost no
  // backoff; the grouping must not go through it, and must not answer 5xx.
  const { db, paper, group, stores } = await repository();
  const { failureBackoffMs } = await import("../src/lib/topic-theme-service");
  await paper(1, ["Dynamic Assessment Modalities"]);
  await paper(2, ["Dynamic Assessment Interactional Frameworks"]);
  await paper(3, ["Washback"]);
  const requests: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    requests.push(String(input instanceof Request ? input.url : input));
    throw new Error("no network in this test");
  }) as typeof fetch;
  try {
    const unreadable = model(() => "not json");
    assert.deepEqual(await quietly(() => group({ projectId: PROJECT })), { status: 200, body: { status: "failed" } });
    assert.equal(unreadable.calls.length, 6, "three groupings, and the missing ones asked for once more");
    const [failed] = await stores();
    assert.equal(failed.payload.failures, 1);
    assert.equal(failed.payload.pendingSince ?? null, null, "the claim is released");
    assert.ok(failed.payload.failedAt);

    // Within the backoff, neither the request nor a read asks again.
    assert.deepEqual(await quietly(() => group({ projectId: PROJECT })), { status: 200, body: { status: "unavailable" } });
    const { loadDashboardDataServer } = await import("../src/lib/dashboard-data-server");
    assert.equal((await quietly(() => loadDashboardDataServer(OWNER, [], PROJECT, "live", { fresh: true }))).topicThemes?.status, "unavailable");
    assert.equal(unreadable.calls.length, 6);

    // The backoff doubles: 15 minutes after one failure, 30 after two.
    const failedAgo = (minutes: number, failures: number) =>
      db.query(`UPDATE workspace_analytics_cache SET payload = payload || jsonb_build_object('failedAt', $1::text, 'failures', $2::int)`, [
        new Date(Date.now() - minutes * 60_000).toISOString(),
        failures,
      ]);
    await failedAgo(20, 1);
    assert.deepEqual(await quietly(() => group({ projectId: PROJECT })), { status: 200, body: { status: "failed" } }, "tried again after 15 minutes");
    assert.equal((await stores())[0].payload.failures, 2);
    await failedAgo(20, 2);
    assert.deepEqual(await quietly(() => group({ projectId: PROJECT })), { status: 200, body: { status: "unavailable" } }, "not yet after 20 of 30");
    assert.deepEqual([1, 2, 3, 20].map(failureBackoffMs), [15 * 60_000, 30 * 60_000, 60 * 60_000, 24 * 60 * 60_000], "up to a day");
    assert.deepEqual(requests, [], "no task queue, no request of its own");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("one grouping runs at a time: a second request finds the claim and is told to wait", async () => {
  const { paper, group } = await repository();
  await paper(1, ["Dynamic Assessment Modalities"]);
  await paper(2, ["Dynamic Assessment Interactional Frameworks"]);
  await paper(3, ["Washback"]);
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const script = model(async () => {
    await gate;
    return GROUPED;
  });
  const first = quietly(() => group({ projectId: PROJECT }));
  while (script.calls.length < 3) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(await group({ projectId: PROJECT }), { status: 200, body: { status: "busy" } });
  open();
  assert.equal((await first).body.status, "grouped");
  assert.equal(script.calls.length, 3, "the model was asked for one grouping");
});

test("grouping runs with the settings it was evaluated with", async () => {
  const { db, paper, group, stores } = await repository();
  await paper(1, ["Dynamic Assessment Modalities"]);
  await paper(2, ["Dynamic Assessment Interactional Frameworks"]);
  await paper(3, ["Washback"]);
  const evaluated = model(() => GROUPED);
  await quietly(() => group({ projectId: PROJECT }));
  assert.deepEqual(
    evaluated.calls.map((call) => [call.taskName, call.parameters.reasoningEffort, call.parameters.jsonObject]),
    [0, 1, 2].map(() => ["TOPIC_THEME_GROUPING", "low", true])
  );

  // One usable grouping is not a consensus.
  await db.query(`DELETE FROM workspace_analytics_cache`);
  let replies = 0;
  const once = model(() => (replies++ === 0 ? GROUPED : "not json"));
  assert.equal((await quietly(() => group({ projectId: PROJECT }))).body.status, "failed");
  assert.equal(once.calls.length, 5, "three asked, the two unusable asked again");
  assert.deepEqual((await stores())[0].payload.themes, [], "nothing grouped from one reply");

  // Paper titles were measured and taken out: they pulled one paper's topics
  // together. Putting them back needs the evaluation re-run, not a quiet edit.
  const prompt = groupingMessages(collectTopicItems([row("1", "A Topic", "kw", { title: "A Paper Title" })]))[1].content;
  assert.equal(prompt.includes("A Paper Title"), false);
});

test("the dashboard asks for grouping once per repository and stops asking", async () => {
  globalThis.__auditfixAuth = { hydrated: true, user: { id: OWNER, email: "reader@papertrend.test" }, session: { access_token: "token" } };
  const posts: RequestInit[] = [];
  let answer: (() => void) | null = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/workspace/dashboard-data?")) {
      return Response.json({ data: { trends: [row("1", "A new topic")], tracksSingle: [], tracksMulti: [], topicThemes: { status: "pending", ungroupedTopics: 1, groupedAt: null } } });
    }
    assert.equal(url, "/api/workspace/topic-themes");
    posts.push(init ?? {});
    if (!answer) await new Promise<void>((resolve) => (answer = resolve));
    return Response.json({ status: "failed" });
  }) as typeof fetch;
  const { useDashboardData } = await import("../src/hooks/useData");
  const root = await headlessRoot();
  function Dashboard({ projectId }: { projectId: string }) {
    useDashboardData("all", [], { projectId });
    return null;
  }
  const settle = async () => {
    let before = -1;
    while (before !== posts.length) {
      before = posts.length;
      await root.act(() => new Promise((resolve) => setTimeout(resolve, 60)));
    }
  };
  try {
    // Two views of one repository: one request between them.
    await root.render(createElement(Fragment, null, createElement(Dashboard, { projectId: PROJECT }), createElement(Dashboard, { projectId: PROJECT })));
    await settle();
    assert.equal(posts.length, 1, "one request, however many views ask");
    // The reader moves on; the grouping in flight is not abandoned.
    await root.render(createElement(Fragment));
    assert.equal(posts[0].signal?.aborted ?? false, false, "leaving the page does not cancel it");
    answer!();

    // A view that keeps finding topics pending stops asking after a bounded number of tries.
    posts.length = 0;
    await root.render(createElement(Dashboard, { projectId: OTHER_PROJECT }));
    await settle();
    assert.equal(posts.length, 15);
  } finally {
    await root.unmount();
    globalThis.fetch = realFetch;
  }
});
