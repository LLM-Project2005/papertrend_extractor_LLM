/*
 * Reading a paper table's cells (docs/42), on the server: Chart mode's value
 * reader (chart-reading.ts) for several columns at once. The passages of each
 * paper that bear on the columns are found, a few papers are read in one call,
 * and code keeps a cell only when its sentence is in the paper and, for a
 * number, the number is in its sentence.
 */
import { z } from "zod";
import { checkable, numberInQuote, quoteInText, toNumber, type CheckableText } from "@/lib/chart-reading";
import { createChatCompletionResult } from "@/lib/openai";
import { cellKey, type TableCell, type TableCells, type TableColumn } from "@/lib/paper-table";
import { paperParts, readPapers, type ReadablePaper } from "@/lib/paper-reading";

type Complete = typeof createChatCompletionResult;

/** Characters of each paper read for its row: the passages that bear on the columns, or the whole paper when it fits. */
const ROW_READING = 14_000;
const BATCH_PAPERS = 4;
const CONCURRENCY = 6;

// Lenient for the reasons given in chart-reading.ts: a strict schema threw
// away whole batches for a null where a string was expected.
const RawCellSchema = z.object({
  column: z.coerce.string(),
  reported: z.union([z.boolean(), z.string()]).transform((value) => value === true || value === "true"),
  value: z.union([z.string(), z.number()]).nullish(),
  quote: z.string().nullish(),
  note: z.string().nullish(),
});
type RawCell = z.infer<typeof RawCellSchema>;
const RawReplySchema = z.object({ papers: z.array(z.object({ paperId: z.coerce.string(), cells: z.array(z.unknown()) })) });

function clean(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function jsonObjectIn(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function tableSystem(columns: TableColumn[]): string {
  return [
    "You read academic papers and fill a table: one row per paper, one cell per column, each cell exactly as the paper states it.",
    "The columns:",
    ...columns.map(
      (column) =>
        `- ${column.id}: ${column.name}${column.instruction ? ` - ${column.instruction}` : ""}${column.kind === "number" ? " (a number: the value starts with it in digits, then its unit, e.g. '30 students'; where the paper gives only parts, the value is their total and the note the parts)" : ""}`
    ),
    "For each paper and each column give: reported (false when the text given does not state it); value (the answer, short: at most 25 words, in English); quote (the sentence that states it, copied word for word from the paper's text, at most 300 characters; use … to leave out words inside it); note (a few words qualifying the value itself, e.g. 'two groups of 24 and 25' or 'pilot study only', else empty; never say where in the paper it is stated or what the paper leaves out).",
    "Never infer or estimate what the paper does not state. A number must be printed in its quote. Report the study's own data, not a pilot or a cited study, unless that is all the paper has; then say so in the note.",
    "Each paper's text says whether it is the whole paper or excerpts; read all of it before deciding a paper does not state something.",
    'Return JSON only: {"papers":[{"paperId","cells":[{"column","reported","value","quote","note"}]}]} with every paperId given once and every column for each.',
  ].join("\n");
}

function paperText(paper: ReadablePaper): string {
  return [paper.title, ...paperParts(paper).map((part) => part.text)].join("\n\n");
}

/** Checks one cell against its paper; only a value whose sentence is in the paper is kept. */
export function checkCell(raw: RawCell | undefined, column: TableColumn, text: CheckableText): TableCell {
  if (!raw || !raw.reported) return { value: "", quote: "", note: "", status: "not_stated" };
  const value = clean(raw.value, 240);
  const quote = clean(raw.quote, 400);
  const note = clean(raw.note, 120);
  if (!value) return { value: "", quote: "", note: "", status: "not_stated" };
  if (!quote || !quoteInText(quote, text)) return { value, quote, note, status: "unverified" };
  if (column.kind === "number") {
    const number = toNumber(value);
    if (number === null || !numberInQuote(number, quote, text)) return { value, quote, note, status: "unverified" };
  }
  return { value, quote, note, status: "found" };
}

async function readBatch(
  papers: ReadablePaper[],
  columns: TableColumn[],
  complete: Complete,
  model?: string
): Promise<Map<string, Map<string, RawCell>> | null> {
  const queries = columns.flatMap((column) => [column.name, column.instruction]).filter(Boolean);
  const readings = readPapers(papers, queries, ROW_READING * papers.length);
  const request = JSON.stringify({
    papers: papers.map((paper, index) => ({
      paperId: paper.paperId,
      title: paper.title,
      year: paper.year,
      read: readings[index].whole ? "the whole paper" : "excerpts; […] marks text left out",
      text: readings[index].text,
    })),
  });
  const system = tableSystem(columns);
  let raw = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await complete(
        attempt === 0
          ? [{ role: "system", content: system }, { role: "user", content: request }]
          : [
              { role: "system", content: system },
              { role: "user", content: request },
              { role: "assistant", content: raw.slice(0, 6_000) },
              { role: "user", content: "That was not valid. Reply with the JSON object only, with every paperId once." },
            ],
        0,
        model,
        "PAPER_TABLE_EXTRACT",
        { maxTokens: 1_500 + papers.length * columns.length * 260, reasoningEffort: "low", jsonObject: true, timeoutMs: 120_000 }
      );
      raw = result?.content?.trim() ?? "";
      const parsed = RawReplySchema.safeParse(jsonObjectIn(raw));
      if (parsed.success) {
        const known = new Set(papers.map((paper) => paper.paperId));
        const byPaper = new Map<string, Map<string, RawCell>>();
        for (const entry of parsed.data.papers) {
          if (!known.has(entry.paperId)) continue;
          // One malformed cell costs that cell, not its paper.
          const cells = entry.cells.map((cell) => RawCellSchema.safeParse(cell)).flatMap((cell) => (cell.success ? [cell.data] : []));
          byPaper.set(entry.paperId, new Map(cells.map((cell) => [cell.column, cell])));
        }
        return byPaper;
      }
      // What went wrong, never what the papers say.
      console.warn("paper_table_unparsed", { attempt, replyChars: raw.length, issues: parsed.error.issues.slice(0, 3).map((issue) => `${issue.path.join(".")}:${issue.code}`) });
    } catch (error) {
      console.warn("paper_table_read_failed", { attempt, message: error instanceof Error ? error.message : "unknown_error" });
    }
  }
  return null;
}

/**
 * Reads the given cells, a few papers to a call, and reports each batch's
 * checked cells as it finishes, so a table fills in while it is read.
 */
export async function readTableCells(input: {
  papers: ReadablePaper[];
  columns: TableColumn[];
  wanted: Array<{ paperId: string; columnId: string }>;
  complete?: Complete;
  model?: string;
  onBatch?: (cells: TableCells) => void | Promise<void>;
}): Promise<TableCells> {
  const complete = input.complete ?? createChatCompletionResult;
  const columnsFor = new Map<string, Set<string>>();
  for (const { paperId, columnId } of input.wanted) {
    if (!columnsFor.has(paperId)) columnsFor.set(paperId, new Set());
    columnsFor.get(paperId)!.add(columnId);
  }
  const papers = input.papers.filter((paper) => columnsFor.has(paper.paperId));
  const batches: ReadablePaper[][] = [];
  for (let start = 0; start < papers.length; start += BATCH_PAPERS) batches.push(papers.slice(start, start + BATCH_PAPERS));
  const all: TableCells = {};
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const batch = batches[next];
      next += 1;
      // The columns any paper of the batch still needs; a cell already read is not replaced.
      const ids = new Set(batch.flatMap((paper) => [...(columnsFor.get(paper.paperId) ?? [])]));
      const columns = input.columns.filter((column) => ids.has(column.id));
      const answer = await readBatch(batch, columns, complete, input.model);
      const cells: TableCells = {};
      for (const paper of batch) {
        const text = checkable(paperText(paper));
        for (const column of columns) {
          if (!columnsFor.get(paper.paperId)?.has(column.id)) continue;
          cells[cellKey(paper.paperId, column.id)] = answer
            ? checkCell(answer.get(paper.paperId)?.get(column.id), column, text)
            : { value: "", quote: "", note: "", status: "failed" };
        }
      }
      Object.assign(all, cells);
      await input.onBatch?.(cells);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker));
  return all;
}
