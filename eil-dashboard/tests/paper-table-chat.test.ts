/*
 * A question asked from a paper table's cell (docs/42, 2026-10-29): a Chat
 * conversation named after the cell and about its paper, with the cell above
 * the first question and in mind for every later one, and linked back to the
 * cell. The chat route runs as written against PGlite under the app's role
 * (tests/support/route-harness.ts); only the repository chat answers from a
 * script (stub-chatscope-repository-chat.ts).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { RepositoryChatInput } from "../src/lib/repository-chat";
import { cellChatPrompt, cellChatTitle, tableCellFromMetadata, threadTableCell, type TableCellContext } from "../src/lib/paper-table-chat";
import { routeHarness, stubModule } from "./support/route-harness";

stubModule("/src/lib/repository-chat.ts", new URL("./support/stub-chatscope-repository-chat.ts", import.meta.url).href);

const OWNER = "00000000-0000-4000-8000-00000000000a";
const OTHER = "00000000-0000-4000-8000-00000000000b";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";
const TABLE = "00000000-0000-4000-8000-0000000000d1";

const CELL: TableCellContext = {
  tableId: TABLE,
  tableName: "Study details",
  columnId: "sample-size",
  columnName: "Sample size",
  instruction: "The total number of participants.",
  paperId: "101",
  paperTitle: "Dynamic assessment of reading",
  year: "2024",
  status: "found",
  value: "30 students",
  quote: "Thirty Thai EFL undergraduates (n = 30) took part in the study",
  note: "",
};

test("the model reads which cell a question is about and what the table says there; the reader's words come last", () => {
  const prompt = cellChatPrompt(CELL, "Why not 32?");
  assert.match(prompt, /one cell of the reader's paper table "Study details": the column "Sample size" \(The total number of participants\.\), for the paper "Dynamic assessment of reading" \(2024\)/);
  assert.match(prompt, /The table says: 30 students, from the sentence "Thirty Thai EFL undergraduates \(n = 30\) took part in the study"\./);
  assert.match(prompt, /Answer in the language of the question\./);
  assert.ok(prompt.endsWith("Question: Why not 32?"));
  assert.match(cellChatPrompt({ ...CELL, status: "unverified", value: "32 students", quote: "32 students took part" }, "?"), /answered "32 students", giving the sentence "32 students took part", but that could not be found in the paper/);
  assert.match(cellChatPrompt({ ...CELL, status: "not_stated", value: "", quote: "" }, "?"), /The table says the paper does not state it\./);
  assert.equal(cellChatTitle(CELL), "Sample size · Dynamic assessment of reading");
});

test("a conversation's cell is found among its newest questions, shown only above the first", () => {
  const about = { ...CELL, value: "31 students" };
  assert.equal(threadTableCell([{ role: "user", metadata: {} }]), null);
  assert.deepEqual(threadTableCell([{ role: "user", metadata: { tableCell: CELL } }, { role: "assistant", metadata: {} }]), CELL);
  assert.deepEqual(threadTableCell([{ role: "user", metadata: { tableCell: CELL } }, { role: "user", metadata: { tableCellAbout: about } }]), about);
  assert.deepEqual(threadTableCell([{ role: "user", metadata: { tableCellAbout: about } }]), about, "the first question need not be loaded");
  assert.equal(tableCellFromMetadata({ tableCellAbout: CELL }), null, "a later question shows no cell");
  assert.equal(tableCellFromMetadata({ tableCell: { ...CELL, tableId: "not-a-table" } }), null);
});

async function workspace() {
  const harness = await routeHarness();
  const owner = await harness.signIn(OWNER);
  const other = await harness.signIn(OTHER);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at) VALUES
      ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'EIL Tracks', '{}'::jsonb, 2, 'test', now());
    INSERT INTO paper_tables (id, owner_user_id, project_id, name, columns) VALUES ('${TABLE}', '${OWNER}', '${PROJECT}', 'Study details', '[]'::jsonb);
  `);
  const asked: RepositoryChatInput[] = [];
  const { fallbackPromptPlan } = await import("../src/lib/repository-chat");
  globalThis.__chatScopeRepositoryChat = async (input) => {
    asked.push(input);
    return {
      handled: true,
      answer: "The paper reports 30 [1].",
      citations: [],
      charts: [],
      limitations: [],
      plan: fallbackPromptPlan(input.prompt, false),
      scopeSnapshot: { kind: "selected_papers", label: "1 selected paper", projectId: PROJECT, projectName: null, folderId: null, folderName: null, selectedRunCount: 1, eligiblePaperCount: 1 },
      diagnostics: { projectId: PROJECT, folderId: null, selectedRunCount: 1, paperCount: 1, versionHash: "v1", scopeLabel: "1 selected paper" },
    };
  };
  const { POST } = await import("../src/app/api/chat/route");
  const ask = (headers: Record<string, string>, body: Record<string, unknown>) => POST(harness.request("/api/chat", { headers, body }));
  return { ...harness, owner, other, asked, ask };
}

const SCOPE = { projectId: PROJECT, knowledgeScope: { kind: "selected_papers", projectId: PROJECT, runIds: ["10000000-0000-4000-8000-000000000001"] } };

test("a question from a cell starts a conversation named after it, keeps the cell with it, and links it to the cell", async () => {
  const { db, owner, asked, ask } = await workspace();
  const first = await ask(owner, { ...SCOPE, message: "Why not 32?", messages: [{ role: "user", content: "Why not 32?" }], tableCell: CELL });
  assert.equal(first.status, 200);
  const answer = await first.json();
  assert.equal(answer.thread.title, "Sample size · Dynamic assessment of reading");
  assert.ok(asked[0].prompt.endsWith("Question: Why not 32?"));
  assert.match(asked[0].prompt, /The table says: 30 students/);
  assert.deepEqual(asked[0].history?.at(-1), { role: "user", content: asked[0].prompt }, "the question is not also read bare");

  const question = answer.messages.find((message: { role: string }) => message.role === "user");
  assert.equal(question.content, "Why not 32?", "the conversation keeps the reader's words");
  assert.deepEqual(question.metadata.tableCell, CELL);
  const linked = await db.query<{ cell_chats: Record<string, string> }>(`SELECT cell_chats FROM paper_tables WHERE id = $1`, [TABLE]);
  assert.deepEqual(linked.rows[0].cell_chats, { "101:sample-size": answer.thread.id });

  // A follow-up, here or in Chat, is answered with the cell in mind; the cell is not shown above it again.
  const history = [
    { role: "user", content: "Why not 32?" },
    { role: "assistant", content: "The paper reports 30 [1]." },
    { role: "user", content: "Who left?" },
  ];
  const next = await (await ask(owner, { ...SCOPE, message: "Who left?", messages: history, threadId: answer.thread.id })).json();
  assert.match(asked[1].prompt, /The table says: 30 students/);
  assert.ok(asked[1].prompt.endsWith("Question: Who left?"));
  assert.deepEqual(asked[1].history?.slice(0, 2), history.slice(0, 2));
  const followUp = next.messages.filter((message: { role: string }) => message.role === "user").at(-1);
  assert.equal(followUp.metadata.tableCell, undefined);
  assert.deepEqual(followUp.metadata.tableCellAbout, CELL);

  // An ordinary question is left as it is.
  await ask(owner, { message: "What are the main topics?" });
  assert.equal(asked[2].prompt, "What are the main topics?");
});

test("a cell from someone else's table is not linked, and a malformed one is refused", async () => {
  const { db, other, ask } = await workspace();
  const answer = await ask(other, { message: "Why not 32?", tableCell: CELL });
  assert.equal(answer.status, 200, "the question is still answered");
  const linked = await db.query<{ cell_chats: Record<string, string> }>(`SELECT cell_chats FROM paper_tables WHERE id = $1`, [TABLE]);
  assert.deepEqual(linked.rows[0].cell_chats, {}, "row-level security keeps the owner's table out of reach");
  const refused = await ask(other, { message: "Why?", tableCell: { ...CELL, columnId: "Bad Column" } });
  assert.equal(refused.status, 400);
});

test("every cell opens a panel that asks in Chat, with the paper as its scope, and Chat shows the cell above the question", () => {
  const panel = readFileSync(new URL("../src/components/table/CellPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /knowledgeScope: \{ kind: "selected_papers", projectId, runIds: \[row\.runId\] \}/);
  assert.match(panel, /\.\.\.\(threadId \? \{ threadId \} : \{ tableCell: context \}\)/);
  assert.match(panel, /href=\{`\/workspace\/chat\?thread=\$\{encodeURIComponent\(threadId\)\}`\}/);
  assert.match(panel, /Not confirmed/);
  assert.match(panel, /Read again/);
  const page = readFileSync(new URL("../src/components/table/PaperTableClient.tsx", import.meta.url), "utf8");
  assert.match(page, /<CellPanel/);
  assert.match(page, /cellKeys: \[key\]/, "a cell's own Read again reads that cell");
  assert.doesNotMatch(page, /QuotePanel/);
  const chat = readFileSync(new URL("../src/components/chat/ChatClient.tsx", import.meta.url), "utf8");
  assert.match(chat, /\{tableCell \? <TableCellQuote cell=\{tableCell\} \/> : null\}/);
});
