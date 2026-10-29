/*
 * A question asked from one cell of a paper table (docs/42, 2026-10-29, the
 * user's request): a Chat conversation like any other, about that one paper,
 * that carries the cell it was asked from. The cell is shown above the
 * question, in the table's side panel and in Chat, and every question in the
 * conversation is answered with it in mind, so "why not 32?" makes sense.
 *
 * Shared by the page, Chat and the chat route; no server imports.
 */
import { z } from "zod";

export const TableCellContextSchema = z.object({
  tableId: z.string().uuid(),
  tableName: z.string().max(120),
  columnId: z.string().regex(/^[a-z0-9-]{1,40}$/),
  columnName: z.string().max(60),
  instruction: z.string().max(300).default(""),
  paperId: z.string().regex(/^[A-Za-z0-9-]{1,80}$/),
  paperTitle: z.string().max(500),
  year: z.string().max(20).default(""),
  status: z.enum(["found", "not_stated", "unverified", "failed"]),
  value: z.string().max(240).default(""),
  quote: z.string().max(400).default(""),
  note: z.string().max(120).default(""),
});

export type TableCellContext = z.infer<typeof TableCellContextSchema>;

/** The conversation's name in Chat: the column and the paper. */
export function cellChatTitle(cell: Pick<TableCellContext, "columnName" | "paperTitle">): string {
  return `${cell.columnName} · ${cell.paperTitle}`;
}

/** What the table says in the cell, in a sentence. */
export function cellSays(cell: TableCellContext): string {
  if (cell.status === "found") return `The table says: ${cell.value}${cell.note ? ` (${cell.note})` : ""}, from the sentence "${cell.quote}".`;
  if (cell.status === "unverified") {
    return `The table's reading answered "${cell.value}"${cell.quote ? `, giving the sentence "${cell.quote}"` : ""}, but that could not be found in the paper, so the table shows it as Not confirmed.`;
  }
  if (cell.status === "not_stated") return "The table says the paper does not state it.";
  return "The table has not read it yet.";
}

/**
 * The question as the model reads it: which cell it is about and what the
 * table says there, then the question. The conversation keeps the reader's
 * words alone; this is added each time a question in it is answered.
 */
export function cellChatPrompt(cell: TableCellContext, question: string): string {
  return [
    `This question is about one cell of the reader's paper table "${cell.tableName}": the column "${cell.columnName}"${
      cell.instruction ? ` (${cell.instruction})` : ""
    }, for the paper "${cell.paperTitle}"${cell.year ? ` (${cell.year})` : ""}. ${cellSays(cell)}`,
    "Answer from the paper. Where the question is about the table's value, say plainly whether the paper bears it out. Answer in the language of the question.",
    `Question: ${question}`,
  ].join("\n\n");
}

function cellIn(metadata: unknown, key: "tableCell" | "tableCellAbout"): TableCellContext | null {
  if (!metadata || typeof metadata !== "object") return null;
  const parsed = TableCellContextSchema.safeParse((metadata as Record<string, unknown>)[key]);
  return parsed.success ? parsed.data : null;
}

/** The cell a question was asked from, shown above it; a later question in the conversation has none. */
export function tableCellFromMetadata(metadata: unknown): TableCellContext | null {
  return cellIn(metadata, "tableCell");
}

/**
 * The cell a conversation is about. The first question carries it as
 * `tableCell`, each later one as `tableCellAbout` (not shown again), so it is
 * found among the newest messages even when the oldest are not loaded.
 */
export function threadTableCell(messages: Array<{ role: string; metadata?: unknown }>): TableCellContext | null {
  for (const message of [...messages].reverse()) {
    if (message.role !== "user") continue;
    const cell = cellIn(message.metadata, "tableCell") ?? cellIn(message.metadata, "tableCellAbout");
    if (cell) return cell;
  }
  return null;
}
