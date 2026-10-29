import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { withAiTokenUsageTracking, type AiTokenUsageTotals } from "@/lib/ai-token-usage";
import { summarizeSpend } from "@/lib/answer-cost";
import { runWithCancellation } from "@/lib/chat-cancellation";
import { PaperTableError, getPaperTable, mergePaperTableCells } from "@/lib/cloudsql/paper-table-repository";
import { MAX_COLUMNS, cellsByKey, doubtfulCells, missingCells, visibleColumns, type TableCells } from "@/lib/paper-table";
import { readTableCells } from "@/lib/paper-table-reading";
import { tablePapers } from "@/lib/paper-table-server";
import { assertAiTokenBudget, assertAndRecordAiUsage, GuardError, persistAiTokenUsage } from "@/lib/security-guards";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";
export const maxDuration = 600;

/*
 * Reads a table's empty cells (docs/42): in the columns shown, every cell not
 * read yet and any whose reading failed; a hidden column, and a paper the
 * table leaves out, are not read. With
 * {"again": true} ("Read again") it also reads each "Not stated" and "Not
 * confirmed" cell not yet read from the whole paper, and {"columnIds": [...]}
 * keeps either to those columns; with {"cellKeys": [...]} it reads just those
 * cells from the whole paper, whatever they say (a cell's own "Read again"). The reply is a stream of JSON lines, one per
 * batch of papers as it is read and saved, so the table fills in on the page:
 *   {"type":"start","papers":N,"cells":M}
 *   {"type":"cells","cells":{...},"done":K}
 *   {"type":"done","found":F,"usd":0.012}   or   {"type":"error","error":"..."}
 * Leaving the page stops the reading; what was read by then is kept.
 */

const FillSchema = z.object({
  again: z.boolean().optional(),
  columnIds: z.array(z.string().max(40)).max(MAX_COLUMNS).optional(),
  cellKeys: z.array(z.string().max(130)).max(20).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Sign in to fill a table." }, { status: 401 });
  if (getDatabaseProvider() !== "cloud-sql") return NextResponse.json({ error: "Tables need the Cloud SQL database." }, { status: 501 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "That table was not found." }, { status: 404 });
  // The body is optional: a plain fill sends none.
  const options = FillSchema.safeParse(await request.json().catch(() => ({})));
  if (!options.success) return NextResponse.json({ error: "That reading could not be started." }, { status: 400 });
  const { again: readAgain = false, columnIds, cellKeys } = options.data;

  let table;
  let loaded;
  try {
    table = await getPaperTable(user.id, id);
    loaded = await tablePapers(user.id, table.projectId, table.leftOut);
  } catch (error) {
    if (error instanceof PaperTableError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error("paper_table_load_failed", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "The papers could not be read just now. Try again in a moment." }, { status: 503 });
  }
  // One cell read again reads nothing else.
  const wanted = cellKeys ? [] : missingCells(loaded.rows, table.columns, table.cells).filter((cell) => !columnIds || columnIds.includes(cell.columnId));
  const again = !readAgain ? [] : cellKeys ? cellsByKey(loaded.rows, table.columns, cellKeys) : doubtfulCells(loaded.rows, table.columns, table.cells, columnIds);
  if (visibleColumns(table.columns).length === 0) return NextResponse.json({ error: "Show or add a column first." }, { status: 400 });
  if (wanted.length === 0 && again.length === 0) return NextResponse.json({ done: true, found: 0, usd: 0 });

  try {
    await assertAiTokenBudget(user.id);
    await assertAndRecordAiUsage(user.id, "chart", { route: "paper-table", cells: wanted.length, again: again.length });
  } catch (error) {
    if (error instanceof GuardError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }

  const encoder = new TextEncoder();
  const readerLeft = new AbortController();
  const disconnected = AbortSignal.any([request.signal, readerLeft.signal]);
  const ownerUserId = user.id;
  const columns = table.columns;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: Record<string, unknown>) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          closed = true;
        }
      };
      send({ type: "start", papers: new Set([...wanted, ...again].map((cell) => cell.paperId)).size, cells: wanted.length + again.length });
      let done = 0;
      let found = 0;
      // Kept outside the tracking call so a reading stopped part way still counts what it spent.
      let spent: AiTokenUsageTotals | null = null;
      try {
        await withAiTokenUsageTracking(async (usage) => {
          spent = usage;
          await runWithCancellation(disconnected, () =>
            readTableCells({
              papers: loaded.papers,
              columns,
              wanted,
              again,
              previous: table.cells,
              onBatch: async (cells: TableCells) => {
                // Saved before it is shown: a cell on the page is a cell in the table.
                await mergePaperTableCells(ownerUserId, id, cells);
                const values = Object.values(cells);
                done += values.length;
                found += values.filter((cell) => cell.status === "found").length;
                send({ type: "cells", cells, done });
              },
            })
          );
        });
        send({ type: "done", found, usd: spent ? summarizeSpend((spent as AiTokenUsageTotals).byModel).usd : 0 });
      } catch (error) {
        console.error("paper_table_fill_failed", { message: error instanceof Error ? error.message : "unknown_error" });
        send({ type: "error", error: "The reading stopped part way. What was read is kept; fill again to read the rest." });
      } finally {
        const usage = spent as AiTokenUsageTotals | null;
        if (usage) {
          console.info("paper_table_spend", JSON.stringify({ usd: summarizeSpend(usage.byModel).usd, totalTokens: usage.totalTokens, cells: wanted.length, again: again.length, done, found }));
          await persistAiTokenUsage(ownerUserId, usage, "paper-table").catch(() => undefined);
        }
        closed = true;
        try {
          controller.close();
        } catch {
          // Already closed by the reader leaving.
        }
      }
    },
    cancel() {
      readerLeft.abort();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
