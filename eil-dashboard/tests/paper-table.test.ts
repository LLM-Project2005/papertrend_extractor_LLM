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
  MAX_LEFT_OUT,
  SORT_TITLE,
  SORT_YEAR,
  applyColumnChoice,
  cellKey,
  cellNumber,
  cellsByKey,
  cellsForColumns,
  changeLeftOut,
  changedColumns,
  cleanView,
  columnChoiceKey,
  columnCounts,
  doubtfulCells,
  labelKey,
  leftOutReason,
  missingCells,
  newColumnId,
  paperTableCsv,
  paperTableSheets,
  readTableView,
  sortRows,
  tableStudies,
  tidyLabels,
  viewChips,
  viewFilters,
  viewRows,
  yesNo,
  type TableCells,
  type TableColumn,
  type TableView,
} from "../src/lib/paper-table";
import { tableImageLayout, wrapLines } from "../src/lib/paper-table-png";
import { COLUMN_PRESETS, COLUMN_PRESET_GROUPS, STARTER_SETS } from "../src/lib/paper-table-presets";
import { COLUMNS_PER_CALL, checkCell, readTableCells, tableSystem } from "../src/lib/paper-table-reading";
import { columnLetter, crc32, xlsxBytes } from "../src/lib/xlsx-writer";
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
  // A total given only in parts: kept when each part is in the sentence and they add up.
  const parts = checkable("The participants were 10 Thai learners and 10 native-speaker judges, recruited in 2012.");
  const partsQuote = "The participants were 10 Thai learners and 10 native-speaker judges";
  assert.equal(checkCell({ column: "sample-size", reported: true, value: "20 participants", quote: partsQuote, note: "10 learners and 10 judges" }, SIZE, parts).status, "found");
  assert.equal(checkCell({ column: "sample-size", reported: true, value: "25 participants", quote: partsQuote, note: "10 learners and 10 judges" }, SIZE, parts).status, "unverified", "parts that do not add up");
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

// ---------------------------------------------------------------------------
// The dashboard layout (2026-10-28): ready-made columns to show or hide, and
// downloads as CSV, Excel and PNG. The chart above the table was taken out the
// same day at the user's request.

test("the ready-made columns are many, grouped, each with its own key, an instruction and a kind", () => {
  assert.ok(COLUMN_PRESETS.length >= 60, `${COLUMN_PRESETS.length} ready-made columns`);
  assert.equal(new Set(COLUMN_PRESETS.map((preset) => preset.key)).size, COLUMN_PRESETS.length, "keys are unique");
  assert.equal(new Set(COLUMN_PRESETS.map((preset) => preset.name.toLowerCase())).size, COLUMN_PRESETS.length, "names are unique");
  assert.ok(COLUMN_PRESET_GROUPS.length >= 6);
  for (const preset of COLUMN_PRESETS) {
    assert.match(preset.key, /^[a-z0-9-]{1,40}$/, preset.key);
    assert.ok(preset.instruction.length > 10 && preset.instruction.length <= 300, preset.key);
    assert.ok(["text", "number", "category"].includes(preset.kind), preset.key);
  }
  const keys = new Set(COLUMN_PRESETS.map((preset) => preset.key));
  for (const set of STARTER_SETS) for (const key of set.keys) assert.ok(keys.has(key), `${set.id}: ${key}`);
});

test("the picker shows, hides and adds columns; a hidden column keeps its cells and is not read", () => {
  const start = applyColumnChoice([], new Set(["preset:participants", "preset:sample-size"]), COLUMN_PRESETS);
  assert.deepEqual(start.map((column) => [column.id, column.preset, column.hidden]), [
    ["participants", "participants", undefined],
    ["sample-size", "sample-size", undefined],
  ]);
  const own: TableColumn = { id: "motivation", name: "Motivation", instruction: "", kind: "text" };
  const cells: TableCells = { "101:participants": { value: "30", quote: "q", note: "", status: "found" } };
  const hidden = applyColumnChoice([...start, own], new Set(["preset:sample-size", "column:motivation", "preset:country"]), COLUMN_PRESETS);
  assert.deepEqual(hidden.map((column) => [column.id, Boolean(column.hidden)]), [
    ["participants", true],
    ["sample-size", false],
    ["motivation", false],
    ["country", false],
  ]);
  assert.equal(columnChoiceKey(own), "column:motivation");
  assert.deepEqual(cellsForColumns(cells, start, hidden), cells, "hiding a column keeps what was read");
  const rows = [{ paperId: "101", runId: "r", title: "A", year: "2024" }];
  assert.deepEqual(
    missingCells(rows, hidden, cells).map((cell) => cell.columnId),
    ["sample-size", "motivation", "country"],
    "a hidden column is not read"
  );
  const shownAgain = applyColumnChoice(hidden, new Set(["preset:participants", "preset:sample-size", "column:motivation", "preset:country"]), COLUMN_PRESETS);
  assert.equal(shownAgain[0].hidden, undefined, "showing it again reads nothing: its cell is still there");
  assert.deepEqual(missingCells(rows, shownAgain, cells).map((cell) => cell.columnId), ["sample-size", "motivation", "country"]);
});

const ROWS = [
  { paperId: "1", runId: "r1", title: "Reading study", year: "2021" },
  { paperId: "2", runId: "r2", title: "Writing study", year: "2022" },
  { paperId: "3", runId: "r3", title: "Speaking study", year: "2023" },
];
const COUNTRY: TableColumn = { id: "country", name: "Country", instruction: "", kind: "category", preset: "country" };
const found = (value: string, note = "") => ({ value, quote: "q", note, status: "found" as const });

test("a column made before columns recorded their preset is ticked in its group, not offered twice", () => {
  const legacy: TableColumn = { id: "setting", name: "Setting", instruction: "The country and the kind of school or university where the study took place.", kind: "text" };
  assert.equal(columnChoiceKey(legacy), "preset:setting");
  const hidden = applyColumnChoice([legacy], new Set(["preset:country"]), COLUMN_PRESETS);
  assert.deepEqual(hidden.map((column) => [column.id, Boolean(column.hidden)]), [["setting", true], ["country", false]], "cleared, it hides; no second Setting");
  const kept = applyColumnChoice([legacy], new Set(["preset:setting"]), COLUMN_PRESETS);
  assert.equal(kept.length, 1, "ticked, it stays the one column");
});

test("a number cell is read as the number it starts with, for the Excel sheet", () => {
  assert.equal(cellNumber("1,200 texts"), 1200);
  assert.equal(cellNumber("30 samples"), 30);
  assert.equal(cellNumber("none"), null);
});

/** The files in a stored zip, with each entry's CRC checked. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const files = new Map<string, string>();
  let at = 0;
  while (view.getUint32(at, true) === 0x04034b50) {
    assert.equal(view.getUint16(at + 8, true), 0, "stored");
    const crc = view.getUint32(at + 14, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const name = new TextDecoder().decode(bytes.slice(at + 30, at + 30 + nameLength));
    const data = bytes.slice(at + 30 + nameLength, at + 30 + nameLength + size);
    assert.equal(crc32(data), crc, `${name}: CRC`);
    files.set(name, new TextDecoder().decode(data));
    at += 30 + nameLength + size;
  }
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054b50, "the zip ends with its directory");
  return files;
}

test("the Excel file has the table, numbers as numbers, and a sheet of sources; text is never a formula", () => {
  const cells: TableCells = { "1:sample-size": found("180 students", "three faculties"), "1:country": found("=HYPERLINK(\"x\") & <Thailand>") };
  const sheets = paperTableSheets(ROWS.slice(0, 1), [SIZE, COUNTRY], cells);
  assert.deepEqual(sheets.map((sheet) => sheet.name), ["Table", "Sources"]);
  assert.deepEqual(sheets[0].rows[1], ["Reading study", 2021, 180, "=HYPERLINK(\"x\") & <Thailand>"]);
  assert.deepEqual(sheets[1].rows[1], ["Reading study", 2021, "Sample size", "180 students", "three faculties", "q", "Found"]);

  const files = unzip(xlsxBytes(sheets, new Date(2026, 9, 28, 12, 0, 0)));
  assert.deepEqual([...files.keys()].sort(), [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/workbook.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml",
  ]);
  const table = files.get("xl/worksheets/sheet1.xml") ?? "";
  assert.match(table, /<c r="C2"><v>180<\/v><\/c>/, "a number cell");
  assert.match(table, /<c r="D2" t="inlineStr" s="2"><is><t xml:space="preserve">=HYPERLINK\(&quot;x&quot;\) &amp; &lt;Thailand&gt;<\/t><\/is><\/c>/, "text, escaped, not a formula");
  assert.doesNotMatch(table, /<f>/);
  assert.match(table, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/, "the header row stays in view");
  assert.match(files.get("xl/workbook.xml") ?? "", /<sheet name="Sources" sheetId="2" r:id="rId2"\/>/);
  assert.equal(columnLetter(0), "A");
  assert.equal(columnLetter(26), "AA");
});

test("the picture fits every cell's text to its column, cutting a long one with an ellipsis", () => {
  const measure = (text: string) => text.length * 7;
  assert.deepEqual(wrapLines("one two three four", 70, measure, 3), ["one two", "three four"]);
  assert.deepEqual(wrapLines("a b c d e f g h i j k l", 28, measure, 2), ["a b", "c d…"]);
  assert.deepEqual(wrapLines("การศึกษาภาษาอังกฤษ", 42, measure, 4), ["การศึก", "ษาภาษา", "อังกฤษ"], "a word with no spaces is broken by characters");
  const layout = tableImageLayout(
    { title: "Study details", subtitle: "", rows: ROWS, columns: [SIZE, COUNTRY], cells: { "1:sample-size": found("180 students") }, footnote: "" },
    measure
  );
  assert.equal(layout.columns.length, 2);
  assert.equal(layout.rows.length, 3);
  assert.deepEqual(layout.rows[0].cells.map((cell) => cell.muted), [false, true], "a value in ink; an empty cell muted");
  for (let index = 1; index < layout.rows.length; index += 1) {
    assert.equal(layout.rows[index].y, layout.rows[index - 1].y + layout.rows[index - 1].height, "rows follow on");
  }
  assert.ok(layout.height > layout.rows[2].y + layout.rows[2].height);
});

test("many columns are read a few to a call, each call finding its own passages", async () => {
  const calls: number[] = [];
  const complete = (async (messages: Array<{ role: string; content: string }>) => {
    calls.push((messages[0].content.match(/^- /gm) ?? []).length);
    return { content: JSON.stringify({ papers: [] }), toolCalls: [] };
  }) as unknown as Parameters<typeof readTableCells>[0]["complete"];
  const columns = COLUMN_PRESETS.slice(0, 20).map((preset) => ({ id: preset.key, name: preset.name, instruction: preset.instruction, kind: preset.kind }));
  const wanted = columns.map((column) => ({ paperId: PAPER_A.paperId, columnId: column.id }));
  const cells = await readTableCells({ papers: [PAPER_A], columns, wanted, complete });
  assert.equal(COLUMNS_PER_CALL, 8);
  assert.deepEqual(calls, [8, 8, 4]);
  assert.equal(Object.keys(cells).length, 20);
});

// ---------------------------------------------------------------------------
// The flaws found in the stored tables (2026-10-28 audit): excerpts that
// missed a stated value, labels spelled three ways, old answers never read
// again, and the oldest studies kept past the limit.

const FILLER = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore. ";
/** A paper longer than its excerpts, with the sample stated near its end. */
const LONG = {
  ...PAPER_A,
  paperId: "301",
  title: "A long thesis chapter",
  content: `${FILLER.repeat(420)}There were 25 students in this section. ${FILLER.repeat(20)}`,
};

type Asked = { papers: Array<{ paperId: string; read: string; text: string }> };

test("a paper read in excerpts is read again whole before a cell says Not stated, in one call for every column it lacked", async () => {
  const asked: Asked[] = [];
  const complete = (async (messages: Array<{ role: string; content: string }>) => {
    const request = JSON.parse(messages[1].content) as Asked;
    asked.push(request);
    return {
      content: JSON.stringify({
        papers: request.papers.map((paper) => ({
          paperId: paper.paperId,
          cells:
            paper.read === "the whole paper" && paper.paperId === LONG.paperId
              ? [
                  { column: "participants", reported: true, value: "25 students", quote: "There were 25 students in this section.", note: "" },
                  { column: "sample-size", reported: true, value: "25 students", quote: "There were 25 students in this section.", note: "" },
                ]
              : [
                  { column: "participants", reported: false },
                  { column: "sample-size", reported: false },
                ],
        })),
      }),
      toolCalls: [],
    };
  }) as unknown as Parameters<typeof readTableCells>[0]["complete"];
  const batches: TableCells[] = [];
  const wanted = [PAPER_A, LONG].flatMap((paper) => [PARTICIPANTS, SIZE].map((column) => ({ paperId: paper.paperId, columnId: column.id })));
  const cells = await readTableCells({ papers: [PAPER_A, LONG], columns: [PARTICIPANTS, SIZE], wanted, complete, onBatch: (batch) => void batches.push(batch) });

  assert.equal(LONG.content.length > 40_000, true);
  assert.equal(asked.length, 2, "the first reading, then one second look");
  assert.equal(asked[0].papers.find((paper) => paper.paperId === LONG.paperId)?.read, "excerpts; […] marks text left out");
  assert.deepEqual(asked[1].papers.map((paper) => [paper.paperId, paper.read]), [[LONG.paperId, "the whole paper"]]);
  assert.ok(!Object.keys(batches[0]).some((key) => key.startsWith(`${LONG.paperId}:`)), "a cell from excerpts is not shown as Not stated before the second look");
  assert.equal(cells["301:participants"].status, "found");
  assert.equal(cells["301:sample-size"].value, "25 students");
  assert.equal(cells["301:participants"].readWhole, true);
  assert.equal(cells["101:participants"].status, "not_stated", "a short paper was read whole the first time, so it is not read again");
  assert.equal(cells["101:participants"].readWhole, true);
});

test("a second look that fails leaves the cell to read again; Read again goes straight to the whole paper and keeps the old answer when it fails", async () => {
  const asked: Asked[] = [];
  let answer = false;
  const complete = (async (messages: Array<{ role: string; content: string }>) => {
    const request = JSON.parse(messages[1].content) as Asked;
    asked.push(request);
    if (request.papers.some((paper) => paper.read === "the whole paper") && !answer) return null;
    return {
      content: JSON.stringify({
        papers: request.papers.map((paper) => ({
          paperId: paper.paperId,
          cells: [{ column: "sample-size", reported: answer, value: answer ? "25 students" : null, quote: answer ? "There were 25 students in this section." : null }],
        })),
      }),
      toolCalls: [],
    };
  }) as unknown as Parameters<typeof readTableCells>[0]["complete"];

  const filled = await readTableCells({ papers: [LONG], columns: [SIZE], wanted: [{ paperId: LONG.paperId, columnId: SIZE.id }], complete });
  assert.equal(filled["301:sample-size"].status, "failed", "not looked at again, so not yet read");

  const old = { value: "", quote: "", note: "", status: "not_stated" as const };
  asked.length = 0;
  const kept = await readTableCells({
    papers: [LONG],
    columns: [SIZE],
    wanted: [],
    again: [{ paperId: LONG.paperId, columnId: SIZE.id }],
    previous: { "301:sample-size": old },
    complete,
  });
  assert.ok(asked.every((request) => request.papers.every((paper) => paper.read === "the whole paper")), "Read again does not read excerpts first");
  assert.deepEqual(kept["301:sample-size"], old);

  answer = true;
  const read = await readTableCells({
    papers: [LONG],
    columns: [SIZE],
    wanted: [],
    again: [{ paperId: LONG.paperId, columnId: SIZE.id }],
    previous: { "301:sample-size": old },
    complete,
  });
  assert.equal(read["301:sample-size"].status, "found");
  assert.equal(read["301:sample-size"].readWhole, true);
});

test("every column of a call is searched for, the eighth as much as the first", async () => {
  const texts: string[] = [];
  const complete = (async (messages: Array<{ role: string; content: string }>) => {
    texts.push((JSON.parse(messages[1].content) as Asked).papers[0].text);
    return { content: JSON.stringify({ papers: [] }), toolCalls: [] };
  }) as unknown as Parameters<typeof readTableCells>[0]["complete"];
  const columns: TableColumn[] = [
    ...COLUMN_PRESETS.slice(0, 7).map((preset) => ({ id: preset.key, name: preset.name, instruction: preset.instruction, kind: preset.kind })),
    { id: "intonation", name: "Intonation", instruction: "How intonation was rated.", kind: "text" },
  ];
  const paper = { ...LONG, content: `${FILLER.repeat(420)}Intonation was rated by two trained judges on a five-point scale. ${FILLER.repeat(20)}` };
  await readTableCells({ papers: [paper], columns, wanted: columns.map((column) => ({ paperId: paper.paperId, columnId: column.id })), complete });
  assert.match(texts[0], /Intonation was rated by two trained judges/, "the eighth column's passage is among the excerpts");
});

test("a label written in different ways is shown one way, the commonest", () => {
  const METHOD: TableColumn = { id: "methodology", name: "Methodology", instruction: "", kind: "category" };
  const label = (value: string) => ({ value, quote: "q", note: "", status: "found" as const });
  const cells: TableCells = {
    "1:methodology": label("Mixed methods"),
    "2:methodology": label("Mixed methods"),
    "3:methodology": label("Mixed-methods"),
    "4:methodology": label("Mixed-method; Case studies"),
    "5:methodology": label("Case study"),
    "6:methodology": label("Case study"),
    "7:methodology": label("Mixed methods; Mixed-methods"),
    "8:methodology": label("การวิจัยเชิงคุณภาพ"),
    "1:participants": { ...label("Mixed-methods sample"), value: "Mixed-methods sample" },
    "9:methodology": { value: "", quote: "", note: "", status: "not_stated" },
  };
  const tidy = tidyLabels([METHOD, PARTICIPANTS], cells);
  assert.deepEqual(
    ["1", "3", "4", "5", "7", "8"].map((paper) => tidy[`${paper}:methodology`].value),
    ["Mixed methods", "Mixed methods", "Mixed methods; Case study", "Case study", "Mixed methods", "การวิจัยเชิงคุณภาพ"]
  );
  assert.equal(tidy["1:participants"].value, "Mixed-methods sample", "a words column is left as read");
  assert.equal(cells["3:methodology"].value, "Mixed-methods", "the stored cells keep what was read");
  assert.equal(labelKey("Case Studies"), labelKey("case-study"));
  assert.notEqual(labelKey("Quantitative"), labelKey("Qualitative"));
  const settled = { "1:methodology": label("Mixed methods") };
  assert.equal(tidyLabels([METHOD], settled), settled, "nothing to tidy, nothing copied");
});

test("Read again takes the Not stated and Not confirmed cells read from part of a paper, in the columns shown or the one given", () => {
  const rows = [
    { paperId: "1", runId: "r1", title: "A", year: "2020" },
    { paperId: "2", runId: "r2", title: "B", year: "2021" },
  ];
  const none = (status: "not_stated" | "unverified" | "failed", readWhole?: boolean) => ({ value: "", quote: "", note: "", status, ...(readWhole ? { readWhole } : {}) });
  const cells: TableCells = {
    "1:participants": none("not_stated"),
    "1:sample-size": none("unverified"),
    "2:participants": none("not_stated", true),
    "2:sample-size": none("failed"),
    "1:country": none("not_stated"),
  };
  const country = { ...COUNTRY, hidden: true };
  assert.deepEqual(doubtfulCells(rows, [PARTICIPANTS, SIZE, country], cells), [
    { paperId: "1", columnId: "participants" },
    { paperId: "1", columnId: "sample-size" },
  ]);
  assert.deepEqual(doubtfulCells(rows, [PARTICIPANTS, SIZE], cells, ["sample-size"]), [{ paperId: "1", columnId: "sample-size" }]);
});

test("past the limit a table keeps the newest studies, listed oldest first", () => {
  const studies = [
    ...Array.from({ length: 130 }, (_, index) => ({ title: `Study ${index}`, year: String(1900 + index) })),
    { title: "Undated", year: "Unknown" },
  ];
  const kept = tableStudies(studies);
  assert.equal(kept.length, 120);
  assert.equal(kept[0].year, "1910", "the ten oldest and the undated one are left out");
  assert.equal(kept.at(-1)?.year, "2029");
  const few = tableStudies([{ title: "B", year: "Unknown" }, { title: "A", year: "2024" }, { title: "C", year: "2011" }]);
  assert.deepEqual(few.map((study) => study.title), ["C", "A", "B"], "under the limit, every study, undated last");
});

test("Read again reads the doubtful cells from the whole paper, and only those", async () => {
  const { db, request, owner } = await repository();
  const requests = model();
  const tables = await import("../src/app/api/workspace/tables/route");
  const fillRoute = await import("../src/app/api/workspace/tables/[id]/fill/route");
  const made = await tables.POST(request("/api/workspace/tables", { headers: owner, body: { projectId: PROJECT, name: "Study details", columns: [PARTICIPANTS] } }));
  const { table } = await made.json();
  const old: TableCells = {
    "101:participants": { value: "", quote: "", note: "", status: "not_stated" },
    "102:participants": { value: "", quote: "", note: "", status: "not_stated", readWhole: true },
  };
  await db.query(`UPDATE paper_tables SET cells = $1::jsonb WHERE id = $2`, [JSON.stringify(old), table.id]);

  const plain = await fillRoute.POST(request(`/api/workspace/tables/${table.id}/fill`, { headers: owner, method: "POST" }), params({ id: table.id }));
  assert.deepEqual(await plain.json(), { done: true, found: 0, usd: 0 }, "a fill reads only empty cells");

  const again = await fillRoute.POST(request(`/api/workspace/tables/${table.id}/fill`, { headers: owner, body: { again: true } }), params({ id: table.id }));
  const events = (await again.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events[0].cells, 1, "the cell already read from the whole paper is passed by");
  assert.equal(events.at(-1).found, 1);
  assert.equal(requests.length, 1);
  const stored = (await db.query<{ cells: TableCells }>(`SELECT cells FROM paper_tables WHERE id = $1`, [table.id])).rows[0].cells;
  assert.equal(stored["101:participants"].status, "found");
  assert.equal(stored["101:participants"].readWhole, true);
  assert.deepEqual(stored["102:participants"], old["102:participants"]);

  const twice = await fillRoute.POST(request(`/api/workspace/tables/${table.id}/fill`, { headers: owner, body: { again: true } }), params({ id: table.id }));
  assert.deepEqual(await twice.json(), { done: true, found: 0, usd: 0 }, "nothing is left to read again");
  const refused = await fillRoute.POST(request(`/api/workspace/tables/${table.id}/fill`, { headers: owner, body: { again: "yes" } }), params({ id: table.id }));
  assert.equal(refused.status, 400);
});

test("the table scrolls in a frame no taller than the screen, its header row and paper column kept in view", () => {
  const page = readFileSync(new URL("../src/components/table/PaperTableClient.tsx", import.meta.url), "utf8");
  // The table starts 312px down at 1440x950 (pilot, 2026-10-29): 19rem left its foot 8px below the screen.
  assert.match(page, /className="max-h-\[max\(20rem,calc\(100dvh-22rem\)\)\] overflow-auto /);
  assert.match(page, /sticky left-0 top-0 z-30/, "the corner stays over both");
  assert.match(page, /sticky top-0 z-20 [^"]*bg-surface/, "column names stay at the top");
  assert.match(page, /Read again/);
  assert.match(page, /tidyLabels\(columns,/);
  assert.doesNotMatch(page, /downloads as a CSV for a spreadsheet/);
});

test("the page offers the picker and the three downloads, and no chart", () => {
  const page = readFileSync(new URL("../src/components/table/PaperTableClient.tsx", import.meta.url), "utf8");
  assert.match(page, /<TableDownloadMenu\s/);
  assert.match(page, /<ColumnPicker/);
  assert.doesNotMatch(page, /TableChart|recharts/, "only the table, at the user's request");
  const menu = readFileSync(new URL("../src/components/table/TableDownloadMenu.tsx", import.meta.url), "utf8");
  for (const label of ["CSV", "Excel (.xlsx)", "Image (.png)"]) assert.ok(menu.includes(`label: "${label}"`), label);
});

// ---------------------------------------------------------------------------
// The rows (2026-10-29, the user's request): sorting and filtering, papers
// left out by hand or by a yes/no column's No, and downloads of the rows shown.

const DESIGN: TableColumn = { id: "design", name: "Design", instruction: "", kind: "category" };
const UNIVERSITY: TableColumn = { id: "university", name: "University students", instruction: "are empirical studies with university students", kind: "yesno" };
const valued = (value: string, note = "") => ({ value, quote: `${value} quote`, note, status: "found" as const });
const blank = (status: "not_stated" | "unverified" | "failed") => ({ value: "", quote: "", note: "", status });

const VIEW_ROWS = [
  { paperId: "1", runId: "r1", title: "Peer feedback in writing", year: "2011" },
  { paperId: "2", runId: "r2", title: "Dynamic assessment of reading", year: "2019" },
  { paperId: "3", runId: "r3", title: "A corpus of learner speech", year: "2024" },
  { paperId: "4", runId: "r4", title: "Teacher talk", year: "Unknown" },
];
const VIEW_CELLS: TableCells = {
  "1:sample-size": valued("180 students"),
  "2:sample-size": valued("30 learners"),
  "3:sample-size": valued("1,200 texts"),
  "4:sample-size": blank("not_stated"),
  "1:design": valued("Mixed-methods"),
  "2:design": valued("Quasi-experimental; Mixed methods"),
  "3:design": valued("Corpus study"),
  "4:design": blank("unverified"),
  "1:participants": valued("Thai EFL undergraduates", "two intact classes"),
  "2:participants": valued("Grade 11 students"),
};

test("rows sort by a number as a number and by words as words, a cell without a value last either way", () => {
  const columns = [SIZE, DESIGN, PARTICIPANTS];
  const initials = (rows: Array<{ title: string }>) => rows.map((row) => row.title[0]);
  assert.deepEqual(initials(sortRows(VIEW_ROWS, columns, VIEW_CELLS, { by: "sample-size", descending: true })), ["A", "P", "D", "T"]);
  assert.deepEqual(initials(sortRows(VIEW_ROWS, columns, VIEW_CELLS, { by: "sample-size", descending: false })), ["D", "P", "A", "T"]);
  assert.deepEqual(initials(sortRows(VIEW_ROWS, columns, VIEW_CELLS, { by: "design", descending: false })), ["A", "P", "D", "T"]);
  assert.deepEqual(initials(sortRows(VIEW_ROWS, columns, VIEW_CELLS, { by: SORT_YEAR, descending: true })), ["A", "D", "P", "T"], "an undated paper stays last");
  assert.deepEqual(initials(sortRows(VIEW_ROWS, columns, VIEW_CELLS, { by: SORT_TITLE, descending: false })), ["A", "D", "P", "T"]);
  assert.equal(sortRows(VIEW_ROWS, columns, VIEW_CELLS, null), VIEW_ROWS, "no sort keeps the table's own order");
});

test("rows filter by a label however it is written, a range, words, the kind of cell, the title and the years", () => {
  const columns = [SIZE, DESIGN, PARTICIPANTS];
  const ids = (view: TableView) => viewRows(VIEW_ROWS, columns, VIEW_CELLS, view).map((row) => row.paperId);
  assert.deepEqual(ids({ columns: { design: { show: ["found"], labels: ["Mixed methods"] } } }), ["1", "2"], "Mixed-methods, and one of two labels, both count");
  assert.deepEqual(ids({ columns: { design: { show: ["found", "unverified"], labels: ["Corpus study"] } } }), ["3", "4"]);
  assert.deepEqual(ids({ columns: { "sample-size": { show: ["found"], min: 100, max: null } } }), ["1", "3"], "1,200 is read as 1200");
  assert.deepEqual(ids({ columns: { "sample-size": { show: ["not_stated"] } } }), ["4"]);
  assert.deepEqual(ids({ columns: { participants: { show: ["found"], text: "INTACT" } } }), ["1"], "words are found in the note too");
  assert.deepEqual(ids({ columns: { participants: { show: ["empty"] } } }), ["3", "4"], "a cell not read yet");
  assert.deepEqual(ids({ title: "reading" }), ["2"]);
  assert.deepEqual(ids({ yearFrom: 2015 }), ["2", "3"], "an undated paper is outside any range of years");
  assert.deepEqual(ids({ columns: { design: { show: [] } } }), ["1", "2", "3", "4"], "a filter with nothing chosen hides nothing");
  assert.deepEqual(
    ids({ sort: { by: "sample-size", descending: true }, columns: { design: { show: ["found"], labels: ["mixed method"] } } }),
    ["1", "2"],
    "filtered, then sorted"
  );
});

test("a filter or sort on a column no longer shown is set aside, and the view reads as chips", () => {
  const hidden = [SIZE, { ...DESIGN, hidden: true }];
  const view: TableView = { sort: { by: "design", descending: false }, columns: { design: { show: ["found"], labels: ["Corpus study"] } } };
  const clean = cleanView(view, hidden);
  assert.equal(clean.sort, null);
  assert.deepEqual(clean.columns, {});
  assert.equal(viewFilters(clean, hidden), false);
  assert.equal(viewRows(VIEW_ROWS, hidden, VIEW_CELLS, clean).length, 4);

  const chips = viewChips(
    {
      title: "writing",
      yearFrom: 2015,
      yearTo: 2024,
      sort: { by: "sample-size", descending: true },
      columns: { design: { show: ["found", "not_stated"], labels: ["Mixed methods"] }, "sample-size": { show: ["found"], min: 30, max: null } },
    },
    [SIZE, DESIGN]
  );
  assert.deepEqual(
    chips.map((chip) => chip.label),
    ["Title has “writing”", "Years 2015–2024", "Sample size: 30 or more", "Design: Mixed methods, Not stated", "Sorted: Sample size, high to low"]
  );
});

test("a view kept in the browser is read back only when it is one", () => {
  assert.deepEqual(readTableView({ sort: { by: "design", descending: true }, columns: { design: { labels: ["Corpus study"] } } }), {
    sort: { by: "design", descending: true },
    columns: { design: { show: [], labels: ["Corpus study"] } },
  });
  assert.deepEqual(readTableView({ sort: "design" }), {});
  assert.deepEqual(readTableView("junk"), {});
  assert.deepEqual(readTableView(undefined), {});
});

test("a filter offers a column's labels with their counts, and each kind of cell", () => {
  const counts = columnCounts(VIEW_ROWS, DESIGN, VIEW_CELLS);
  assert.deepEqual(counts.labels, [
    { key: labelKey("Mixed methods"), label: "Mixed-methods", count: 2 },
    { key: labelKey("Corpus study"), label: "Corpus study", count: 1 },
    { key: labelKey("Quasi-experimental"), label: "Quasi-experimental", count: 1 },
  ]);
  assert.deepEqual(counts.kinds, { found: 3, not_stated: 0, unverified: 1, empty: 0 });
  assert.deepEqual(columnCounts(VIEW_ROWS, PARTICIPANTS, VIEW_CELLS).labels, [], "a words column has no labels to offer");
});

test("papers are left out with a reason and put back; the newest reason stands", () => {
  let leftOut = changeLeftOut({}, [
    { paperId: "1", reason: "Not empirical" },
    { paperId: "2", reason: "", columnId: "university" },
  ]);
  assert.deepEqual(leftOut, { "1": { reason: "Not empirical" }, "2": { reason: "", columnId: "university" } });
  leftOut = changeLeftOut(leftOut, [{ paperId: "1", reason: "A review" }], ["2"]);
  assert.deepEqual(leftOut, { "1": { reason: "A review" } });
  const many = changeLeftOut({}, Array.from({ length: MAX_LEFT_OUT + 3 }, (_, index) => ({ paperId: `p${index}`, reason: "" })));
  assert.equal(Object.keys(many).length, MAX_LEFT_OUT);
  assert.equal(many.p0, undefined, "past the limit the oldest go first");
  assert.equal(leftOutReason({ reason: "", columnId: "university" }, [UNIVERSITY]), "University students: No");
  assert.equal(leftOutReason({ reason: "Off topic", columnId: "university" }, [UNIVERSITY]), "Off topic");
});

test("a yes/no column answers Yes or No with the sentence that decides it, and anything else is not confirmed", () => {
  const text = checkable(PAPER_A.content);
  const quote = "Thirty Thai EFL undergraduates (n = 30) took part in the study";
  const yes = checkCell({ column: "university", reported: true, value: "yes - undergraduates", quote, note: "undergraduates" }, UNIVERSITY, text);
  assert.deepEqual(yes, { value: "Yes", quote, note: "undergraduates", status: "found" });
  assert.equal(checkCell({ column: "university", reported: true, value: "NO", quote, note: "" }, UNIVERSITY, text).value, "No");
  assert.equal(checkCell({ column: "university", reported: true, value: "Partly", quote, note: "" }, UNIVERSITY, text).status, "unverified");
  assert.equal(yesNo("Yes."), "Yes");
  assert.equal(yesNo("Not stated"), null, "'Not' is not 'No'");
  assert.match(tableSystem([UNIVERSITY]), /university: University students - are empirical studies with university students \(yes or no: whether the study meets this/);
});

test("the workbook lists the papers left out, with the sentence of the yes/no column that left one out", () => {
  const cells: TableCells = { ...VIEW_CELLS, "9:university": { value: "No", quote: "Forty Grade 10 students took part.", note: "secondary school", status: "found" } };
  const leftOut = [
    { paperId: "9", runId: "r9", title: "School study", year: "2020", reason: "", columnId: "university" },
    { paperId: "8", runId: "r8", title: "A review", year: "2018", reason: "Not empirical" },
  ];
  const sheets = paperTableSheets([VIEW_ROWS[0]], [SIZE], cells, leftOut, [SIZE, UNIVERSITY]);
  assert.deepEqual(
    sheets.map((sheet) => sheet.name),
    ["Table", "Sources", "Left out"]
  );
  assert.deepEqual(sheets[2].rows, [
    ["Paper", "Year", "Reason", "Sentence in the paper"],
    ["School study", 2020, "University students: No", "Forty Grade 10 students took part."],
    ["A review", 2018, "Not empirical", ""],
  ]);
  assert.equal(paperTableSheets([VIEW_ROWS[0]], [SIZE], VIEW_CELLS).length, 2, "no papers left out, no third sheet");
});

test("the rows migration adds the two fields, is folded into schema.sql and recorded in the ledger", () => {
  const migration = readFileSync(new URL("../cloudsql/20261029_paper_table_rows.sql", import.meta.url), "utf8");
  const schema = readFileSync(new URL("../cloudsql/schema.sql", import.meta.url), "utf8");
  assert.match(migration, /INSERT INTO public\.schema_migrations \(name\) VALUES \('20261029_paper_table_rows\.sql'\)/);
  for (const text of [migration, schema]) {
    assert.match(text, /ADD COLUMN IF NOT EXISTS left_out JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
    assert.match(text, /ADD COLUMN IF NOT EXISTS cell_chats JSONB NOT NULL DEFAULT '\{\}'::jsonb/);
  }
  assert.doesNotMatch(migration, /UPDATE |DELETE |DROP /, "additive only");
});

test("a paper left out leaves the table and its fill, is listed with its reason, and comes back when put back", async () => {
  const { db, request, owner, other } = await repository();
  const requests = model();
  const tables = await import("../src/app/api/workspace/tables/route");
  const one = await import("../src/app/api/workspace/tables/[id]/route");
  const fillRoute = await import("../src/app/api/workspace/tables/[id]/fill/route");
  const made = await tables.POST(request("/api/workspace/tables", { headers: owner, body: { projectId: PROJECT, name: "Study details", columns: [PARTICIPANTS] } }));
  const { table } = await made.json();
  const patch = (headers: Record<string, string>, body: unknown) =>
    one.PATCH(request(`/api/workspace/tables/${table.id}`, { headers, method: "PATCH", body }), params({ id: table.id }));

  assert.equal((await patch(other, { leaveOut: [{ paperId: "102", reason: "theirs" }] })).status, 404);
  assert.equal((await patch(owner, { leaveOut: [{ paperId: "102", reason: "x".repeat(201) }] })).status, 400);
  assert.equal((await patch(owner, { leaveOut: [{ paperId: "1 OR 1=1", reason: "" }] })).status, 400);
  const left = await patch(owner, { leaveOut: [{ paperId: "102", reason: "Not about reading" }] });
  assert.deepEqual((await left.json()).table.leftOut, { "102": { reason: "Not about reading" } });

  const opened = await (await one.GET(request(`/api/workspace/tables/${table.id}`, { headers: owner }), params({ id: table.id }))).json();
  assert.deepEqual(opened.rows.map((row: { paperId: string }) => row.paperId), ["101"]);
  assert.deepEqual(
    opened.leftOutRows.map((row: { paperId: string; title: string; reason: string }) => [row.paperId, row.title, row.reason]),
    [["102", "Peer feedback in writing", "Not about reading"]]
  );

  const filled = await fillRoute.POST(request(`/api/workspace/tables/${table.id}/fill`, { headers: owner, method: "POST" }), params({ id: table.id }));
  const events = (await filled.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events[0].cells, 1, "the paper left out is not read");
  assert.equal(requests.length, 1);
  const stored = (await db.query<{ cells: TableCells; left_out: unknown }>(`SELECT cells, left_out FROM paper_tables WHERE id = $1`, [table.id])).rows[0];
  assert.deepEqual(Object.keys(stored.cells), ["101:participants"]);
  assert.deepEqual(stored.left_out, { "102": { reason: "Not about reading" } });

  await patch(owner, { putBack: ["102"] });
  const back = await (await one.GET(request(`/api/workspace/tables/${table.id}`, { headers: owner }), params({ id: table.id }))).json();
  assert.deepEqual(back.rows.map((row: { paperId: string }) => row.paperId), ["102", "101"], "back in its place, oldest first");
  assert.deepEqual(back.leftOutRows, []);
  assert.deepEqual(back.table.chats, {}, "no conversations yet");
});

test("the page sorts, filters, screens and leaves papers out, and its downloads hold the rows shown", () => {
  const page = readFileSync(new URL("../src/components/table/PaperTableClient.tsx", import.meta.url), "utf8");
  assert.match(page, /onClick=\{\(\) => sortBy\(column\.id, column\.kind === "number"\)\}/, "a column's name sorts by it, a number from the highest");
  assert.match(page, /aria-label=\{`Filter by \$\{column\.name\}`\}/);
  assert.match(page, /aria-label=\{`Leave out \$\{row\.title\}`\}/);
  assert.match(page, /screening: true/);
  assert.match(page, /Leave out the \{answered\.no\.toLocaleString\(\)\} that say No/);
  assert.match(page, /<LeftOutList /);
  assert.match(page, /paperTableCsv\(table\.name, shownRows,/);
  assert.match(page, /paperTableSheets\(shownRows, shownColumns, cells, leftOutRows, columns\)/);
  assert.match(page, /rows: shownRows,/);
  assert.match(page, /\{shownRows\.map\(\(row\) =>/);
  // Pilot, 2026-10-29: a filter left "Read 36 cells: …" where "18 of 36 studies shown" belongs.
  assert.match(page, /setNotice\(\(current\) => \(current === undoNotice \? current : null\)\)/, "a new view clears a fill's message, not an Undo");
  assert.match(page, /<span className="sr-only">, asked about<\/span>/, "the conversation's mark is read out, as its icon is hidden");
});

test("a cell's own Read again reads that one cell from the whole paper, whatever it says", async () => {
  const rows = [
    { paperId: "101", runId: "r1", title: "A", year: "2024" },
    { paperId: "102", runId: "r2", title: "B", year: "2021" },
  ];
  assert.deepEqual(cellsByKey(rows, [PARTICIPANTS, { ...SIZE, hidden: true }], ["101:participants", "101:sample-size", "999:participants"]), [
    { paperId: "101", columnId: "participants" },
  ]);

  const { db, request, owner } = await repository();
  const requests = model();
  const tables = await import("../src/app/api/workspace/tables/route");
  const fillRoute = await import("../src/app/api/workspace/tables/[id]/fill/route");
  const made = await tables.POST(request("/api/workspace/tables", { headers: owner, body: { projectId: PROJECT, name: "Study details", columns: [PARTICIPANTS] } }));
  const { table } = await made.json();
  const old: TableCells = {
    "101:participants": { value: "29 undergraduates", quote: "Thirty Thai EFL undergraduates", note: "", status: "found" },
    "102:participants": { value: "", quote: "", note: "", status: "not_stated", readWhole: true },
  };
  await db.query(`UPDATE paper_tables SET cells = $1::jsonb WHERE id = $2`, [JSON.stringify(old), table.id]);

  const one = await fillRoute.POST(
    request(`/api/workspace/tables/${table.id}/fill`, { headers: owner, body: { again: true, cellKeys: ["101:participants"] } }),
    params({ id: table.id })
  );
  const events = (await one.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events[0].cells, 1);
  assert.equal(requests.length, 1);
  const stored = (await db.query<{ cells: TableCells }>(`SELECT cells FROM paper_tables WHERE id = $1`, [table.id])).rows[0].cells;
  assert.equal(stored["101:participants"].value, "30 Thai EFL undergraduates", "a found value is read again too");
  assert.equal(stored["101:participants"].readWhole, true);
  assert.deepEqual(stored["102:participants"], old["102:participants"]);

  const none = await fillRoute.POST(
    request(`/api/workspace/tables/${table.id}/fill`, { headers: owner, body: { again: true, cellKeys: ["999:participants"] } }),
    params({ id: table.id })
  );
  assert.deepEqual(await none.json(), { done: true, found: 0, usd: 0 }, "a cell not in the table reads nothing");
  assert.equal(requests.length, 1);
});

test("the Table shows the day's AI allowance beside Fill table, and filling counts against it", () => {
  // 2026-11-01, the owner: filling a table is not unlimited, and the reader should see that.
  const client = readFileSync(new URL("../src/components/table/PaperTableClient.tsx", import.meta.url), "utf8");
  const meter = client.indexOf("<UsageMeter");
  assert.ok(meter > 0, "the usage meter is on the Table");
  assert.ok(meter < client.indexOf("Fill table", meter), "beside the Fill table button");
  assert.match(client.slice(meter, meter + 400), /placement="below"/, "its panel opens downward from the toolbar");
  assert.match(client.slice(meter, meter + 400), /note="[^"]*allowance[^"]*"/, "it says what on the page uses the allowance");
  // The meter adds up the same token rows the fill route writes and checks.
  const fill = readFileSync(new URL("../src/app/api/workspace/tables/[id]/fill/route.ts", import.meta.url), "utf8");
  assert.match(fill, /await assertAiTokenBudget\(user\.id\)/, "a fill starts only with allowance left");
  assert.match(fill, /persistAiTokenUsage\([^)]*"paper-table"\)/, "its tokens are counted in the day's use");
});
