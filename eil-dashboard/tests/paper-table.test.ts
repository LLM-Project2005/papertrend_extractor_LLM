/*
 * The paper table (docs/42): the shared rules for columns and cells, the
 * reading with its quote check, the CSV, and the routes run against PGlite
 * under the app's role (tests/support/route-harness.ts) with the model
 * answering as OpenRouter would. Nothing leaves the process.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkable } from "../src/lib/chart-reading";
import {
  cellKey,
  cellsForColumns,
  changedColumns,
  missingCells,
  newColumnId,
  paperTableCsv,
  type TableCells,
  type TableColumn,
} from "../src/lib/paper-table";
import { checkCell, readTableCells, tableSystem } from "../src/lib/paper-table-reading";
import { params, routeHarness } from "./support/route-harness";

const PARTICIPANTS: TableColumn = { id: "participants", name: "Participants", instruction: "Who took part and how many in all.", kind: "text" };
const SIZE: TableColumn = { id: "sample-size", name: "Sample size", instruction: "The total number of participants.", kind: "number" };

const PAPER_A = {
  paperId: "101",
  title: "Dynamic assessment of reading",
  year: "2024",
  abstract: "",
  methods: "",
  results: "",
  conclusion: "",
  content: "Method. Thirty Thai EFL undergraduates (n = 30) took part in the study over ten weeks. Results. Mediated scores rose on every test.",
  contentSource: "full_text" as const,
};
const PAPER_B = {
  ...PAPER_A,
  paperId: "102",
  title: "Peer feedback in writing",
  year: "2021",
  content: "This qualitative case study followed one writing class. Interviews and drafts were analysed thematically.",
};

test("a new column's id is short, safe in a cell key, and its own", () => {
  assert.equal(newColumnId("Sample size (n)", []), "sample-size-n");
  assert.equal(newColumnId("Sample size", ["sample-size"]), "sample-size-2");
  assert.equal(newColumnId("ประเทศ", []), "column", "a name with no Latin letters still gets an id");
});

test("a column only renamed keeps its cells; a new instruction, a new kind or a removed column loses them", () => {
  const renamed = { ...PARTICIPANTS, name: "Learners" };
  assert.deepEqual(changedColumns([PARTICIPANTS, SIZE], [renamed, SIZE]), []);
  assert.deepEqual(changedColumns([PARTICIPANTS], [{ ...PARTICIPANTS, instruction: "Only the number of learners." }]), ["participants"]);
  assert.deepEqual(changedColumns([SIZE], [{ ...SIZE, kind: "text" }]), ["sample-size"]);
  const bare = { ...PARTICIPANTS, instruction: "" };
  assert.deepEqual(changedColumns([bare], [{ ...bare, name: "Country" }]), ["participants"], "with no instruction the name is the question");

  const found = { value: "30 undergraduates", quote: "Thirty Thai EFL undergraduates", note: "", status: "found" as const };
  const cells: TableCells = { [cellKey("101", "participants")]: found, [cellKey("101", "sample-size")]: { ...found, value: "30" } };
  assert.deepEqual(Object.keys(cellsForColumns(cells, [PARTICIPANTS, SIZE], [renamed])), ["101:participants"]);
});

test("a fill reads the cells not read yet and those whose reading failed, never one already answered", () => {
  const rows = [
    { paperId: "101", runId: "r1", title: "A", year: "2024" },
    { paperId: "102", runId: "r2", title: "B", year: "2021" },
  ];
  const cells: TableCells = {
    "101:participants": { value: "", quote: "", note: "", status: "not_stated" },
    "102:participants": { value: "", quote: "", note: "", status: "failed" },
  };
  assert.deepEqual(missingCells(rows, [PARTICIPANTS, SIZE], cells), [
    { paperId: "101", columnId: "sample-size" },
    { paperId: "102", columnId: "participants" },
    { paperId: "102", columnId: "sample-size" },
  ]);
});

test("a cell is kept only when its sentence is in the paper, and a number only when the number is in its sentence", () => {
  const text = checkable(PAPER_A.content);
  const quote = "Thirty Thai EFL undergraduates (n = 30) took part in the study";
  assert.equal(checkCell({ column: "participants", reported: true, value: "30 Thai EFL undergraduates", quote, note: "" }, PARTICIPANTS, text).status, "found");
  assert.equal(checkCell({ column: "sample-size", reported: true, value: "30", quote, note: "" }, SIZE, text).status, "found");
  assert.equal(checkCell({ column: "sample-size", reported: true, value: "45", quote, note: "" }, SIZE, text).status, "unverified", "a number not in its sentence");
  assert.equal(
    checkCell({ column: "participants", reported: true, value: "60 teachers", quote: "Sixty teachers in Bangkok answered a survey", note: "" }, PARTICIPANTS, text).status,
    "unverified",
    "a sentence the paper does not have"
  );
  assert.equal(checkCell({ column: "participants", reported: false, value: null, quote: null, note: null }, PARTICIPANTS, text).status, "not_stated");
  assert.equal(checkCell(undefined, PARTICIPANTS, text).status, "not_stated", "a paper the reply left out");
});

test("the table is read a few papers to a call, each batch reported as it is checked, and a failed call is marked to read again", async () => {
  const calls: Array<{ task?: string; user: string }> = [];
  const complete = (async (messages: Array<{ role: string; content: string }>, _temperature?: number, _model?: string, task?: string) => {
    calls.push({ task, user: messages[1].content });
    const request = JSON.parse(messages[1].content) as { papers: Array<{ paperId: string }> };
    if (request.papers.some((paper) => paper.paperId === "102")) return null;
    return {
      content: JSON.stringify({
        papers: [
          {
            paperId: "101",
            cells: [
              { column: "participants", reported: true, value: "30 Thai EFL undergraduates", quote: "Thirty Thai EFL undergraduates (n = 30) took part", note: "" },
              { column: "sample-size", reported: "true", value: 30, quote: "Thirty Thai EFL undergraduates (n = 30) took part", note: null },
            ],
          },
        ],
      }),
      toolCalls: [],
    };
  }) as unknown as Parameters<typeof readTableCells>[0]["complete"];
  const batches: TableCells[] = [];
  const papers = [PAPER_A, ...Array.from({ length: 3 }, (_, index) => ({ ...PAPER_A, paperId: `20${index}` })), PAPER_B];
  const wanted = papers.flatMap((paper) => [PARTICIPANTS, SIZE].map((column) => ({ paperId: paper.paperId, columnId: column.id })));
  const cells = await readTableCells({ papers, columns: [PARTICIPANTS, SIZE], wanted, complete, onBatch: (batch) => void batches.push(batch) });

  assert.ok(calls.every((call) => call.task === "PAPER_TABLE_EXTRACT"));
  assert.equal(batches.length, 2, "four papers to a call");
  assert.equal(cells["101:participants"].status, "found");
  assert.equal(cells["101:sample-size"].value, "30");
  assert.equal(cells["200:participants"].status, "not_stated", "a paper the reply left out");
  assert.equal(cells["102:participants"].status, "failed", "the call for it failed, twice");
  assert.equal(calls.filter((call) => call.user.includes('"102"')).length, 2, "a failed call is tried once more");
});

test("the instructions name each column and forbid a value the paper does not state", () => {
  const system = tableSystem([PARTICIPANTS, SIZE]);
  assert.match(system, /- participants: Participants - Who took part/);
  assert.match(system, /- sample-size: Sample size - .*\(a number: the value starts with it in digits/);
  assert.match(system, /never say where in the paper it is stated/, "a note qualifies the value; it does not narrate the reading");
  assert.match(system, /not a pilot or a cited study/);
  assert.match(system, /Never infer or estimate what the paper does not state/);
  assert.match(system, /copied word for word/);
});

test("the CSV gives each column's value and then the paper's sentence for it", () => {
  const rows = [{ paperId: "101", runId: "r1", title: "Dynamic assessment of reading", year: "2024" }];
  const csv = paperTableCsv("Study details", rows, [PARTICIPANTS, SIZE], {
    "101:participants": { value: "30 undergraduates", quote: "Thirty Thai EFL undergraduates", note: "one class", status: "found" },
    "101:sample-size": { value: "45", quote: "x", note: "", status: "unverified" },
  });
  assert.deepEqual(csv.header, ["Paper", "Year", "Participants", "Participants: sentence in the paper", "Sample size", "Sample size: sentence in the paper"]);
  assert.deepEqual(csv.rows[0], ["Dynamic assessment of reading", "2024", "30 undergraduates (one class)", "Thirty Thai EFL undergraduates", "Not confirmed", ""]);
});

test("the migration is folded into schema.sql, recorded in the ledger, and under row-level security", () => {
  const migration = readFileSync(new URL("../cloudsql/20261028_paper_tables.sql", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../cloudsql/schema.sql", import.meta.url), "utf8");
  assert.match(migration, /INSERT INTO public\.schema_migrations \(name\) VALUES \('20261028_paper_tables\.sql'\)/);
  for (const text of [migration, schema]) {
    assert.match(text, /CREATE TABLE IF NOT EXISTS public\.paper_tables/);
    assert.match(text, /ALTER TABLE public\.paper_tables FORCE ROW LEVEL SECURITY/);
  }
});

// ---------------------------------------------------------------------------
// The routes, as a signed-in person.

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const FOLDER = "00000000-0000-4000-8000-0000000000f1";
const run = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function repository() {
  const harness = await routeHarness({ OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: "https://openrouter.ai/api/v1" });
  const owner = await harness.signIn(OWNER);
  const other = await harness.signIn(OTHER);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at) VALUES
      ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'EIL Tracks', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'Papers', '${PROJECT}');
  `);
  for (const [index, paper] of [PAPER_A, PAPER_B].entries()) {
    await harness.db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, input_payload)
       VALUES ($1, $2, $3, 'upload', 'succeeded', 'paper.pdf', '{}'::jsonb)`,
      [run(index + 1), OWNER, FOLDER]
    );
    await harness.db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, $4, $5)`, [
      Number(paper.paperId),
      OWNER,
      FOLDER,
      paper.year,
      paper.title,
    ]);
    await harness.db.query(
      `INSERT INTO paper_content (paper_id, owner_user_id, folder_id, body, ingestion_run_id) VALUES ($1, $2, $3, $4, $5)`,
      [Number(paper.paperId), OWNER, FOLDER, paper.content, run(index + 1)]
    );
  }
  return { ...harness, owner, other };
}

/** The model, as OpenRouter: it answers the participants column from the dynamic assessment paper only. */
function model() {
  const requests: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(url), "https://openrouter.ai/api/v1/chat/completions", "only the model is called");
    const body = JSON.parse(String(init?.body)) as { model: string; messages: Array<{ content: string }> };
    requests.push(body.model);
    const asked = JSON.parse(body.messages[1].content) as { papers: Array<{ paperId: string }> };
    const content = JSON.stringify({
      papers: asked.papers.map((paper) => ({
        paperId: paper.paperId,
        cells:
          paper.paperId === "101"
            ? [{ column: "participants", reported: true, value: "30 Thai EFL undergraduates", quote: "Thirty Thai EFL undergraduates (n = 30) took part in the study", note: "" }]
            : [{ column: "participants", reported: false }],
      })),
    });
    return new Response(JSON.stringify({ model: body.model, choices: [{ message: { content } }], usage: { prompt_tokens: 900, completion_tokens: 120, total_tokens: 1020 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
  return requests;
}

test("a table is made, opened with the repository's studies, filled with checked cells, and seen by its owner only", async () => {
  const { db, request, owner, other } = await repository();
  const requests = model();
  const tables = await import("../src/app/api/workspace/tables/route");
  const one = await import("../src/app/api/workspace/tables/[id]/route");
  const fillRoute = await import("../src/app/api/workspace/tables/[id]/fill/route");

  assert.equal((await tables.GET(request(`/api/workspace/tables?projectId=${PROJECT}`))).status, 401);
  const refused = await tables.POST(request("/api/workspace/tables", { headers: other, body: { projectId: PROJECT, name: "Theirs", columns: [] } }));
  assert.equal(refused.status, 404, "a table is made only in one's own repository");

  const made = await tables.POST(request("/api/workspace/tables", { headers: owner, body: { projectId: PROJECT, name: "Study details", columns: [PARTICIPANTS] } }));
  assert.equal(made.status, 201);
  const { table } = await made.json();
  assert.equal(requests.length, 0, "making a table reads nothing");

  const listed = await (await tables.GET(request(`/api/workspace/tables?projectId=${PROJECT}`, { headers: owner }))).json();
  assert.deepEqual(listed.tables.map((entry: { name: string }) => entry.name), ["Study details"]);
  assert.ok(listed.presets.some((preset: { name: string }) => preset.name === "Main finding"));

  const opened = await (await one.GET(request(`/api/workspace/tables/${table.id}`, { headers: owner }), params({ id: table.id }))).json();
  assert.deepEqual(
    opened.rows.map((row: { title: string }) => row.title),
    ["Peer feedback in writing", "Dynamic assessment of reading"],
    "one row per study, oldest first"
  );
  assert.equal((await one.GET(request(`/api/workspace/tables/${table.id}`, { headers: other }), params({ id: table.id }))).status, 404);

  const filled = await fillRoute.POST(request(`/api/workspace/tables/${table.id}/fill`, { headers: owner, method: "POST" }), params({ id: table.id }));
  assert.match(filled.headers.get("content-type") ?? "", /ndjson/);
  const events = (await filled.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events[0].type, "start");
  assert.equal(events[0].cells, 2);
  assert.equal(events.at(-1).type, "done");
  assert.equal(events.at(-1).found, 1);
  assert.equal(requests.length, 1, "both papers in one call");
  assert.ok(requests.every((name) => name === "openai/gpt-6-luna-20260922"), "read with GPT-6 Luna");

  const stored = (await db.query<{ cells: TableCells }>(`SELECT cells FROM paper_tables WHERE id = $1`, [table.id])).rows[0].cells;
  assert.equal(stored["101:participants"].status, "found");
  assert.equal(stored["101:participants"].quote, "Thirty Thai EFL undergraduates (n = 30) took part in the study");
  assert.equal(stored["102:participants"].status, "not_stated");
  const spent = await db.query(`SELECT metadata FROM ai_usage_events WHERE owner_user_id = $1 AND metadata->>'source' = 'paper-table'`, [OWNER]);
  assert.equal(spent.rows.length, 1, "the reading counts against the owner's allowance");

  const again = await fillRoute.POST(request(`/api/workspace/tables/${table.id}/fill`, { headers: owner, method: "POST" }), params({ id: table.id }));
  assert.deepEqual(await again.json(), { done: true, found: 0, usd: 0 }, "nothing is read twice");
  assert.equal(requests.length, 1);

  // A new instruction clears the column, so the next fill reads it again; a rename alone does not.
  const renamed = await one.PATCH(
    request(`/api/workspace/tables/${table.id}`, { headers: owner, method: "PATCH", body: { columns: [{ ...PARTICIPANTS, name: "Learners" }] } }),
    params({ id: table.id })
  );
  assert.equal(Object.keys((await renamed.json()).table.cells).length, 2);
  const changed = await one.PATCH(
    request(`/api/workspace/tables/${table.id}`, { headers: owner, method: "PATCH", body: { columns: [{ ...PARTICIPANTS, instruction: "Only the learners' level." }] } }),
    params({ id: table.id })
  );
  assert.equal(Object.keys((await changed.json()).table.cells).length, 0);

  assert.equal((await one.DELETE(request(`/api/workspace/tables/${table.id}`, { headers: other, method: "DELETE" }), params({ id: table.id }))).status, 404);
  assert.equal((await one.DELETE(request(`/api/workspace/tables/${table.id}`, { headers: owner, method: "DELETE" }), params({ id: table.id }))).status, 200);
  assert.equal((await db.query(`SELECT 1 FROM paper_tables`)).rows.length, 0);
});

test("the Table page is in the workspace's navigation and its search", () => {
  const shell = readFileSync(new URL("../src/components/workspace/WorkspaceShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /\{ href: "\/workspace\/table", label: "Table", icon: TableIcon \}/);
  assert.match(shell, /id: "table",\s+label: "Table",/);
});
