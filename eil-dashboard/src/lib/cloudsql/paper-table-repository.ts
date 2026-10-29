import type { PoolClient } from "pg";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import {
  ColumnsSchema,
  MAX_TABLES_PER_REPOSITORY,
  cellsForColumns,
  changeLeftOut,
  type LeftOut,
  type TableCells,
  type TableColumn,
} from "@/lib/paper-table";

/*
 * Paper tables (cloudsql/20261028_paper_tables.sql and
 * 20261029_paper_table_rows.sql, docs/42). Each function's body takes the
 * caller's transaction, so the SQL runs as-is in the PGlite tests; the
 * exported wrappers open the owner's transaction, under which row-level
 * security shows a person only their own tables.
 */

type Client = Pick<PoolClient, "query">;

export interface PaperTableSummary {
  id: string;
  projectId: string;
  name: string;
  columnCount: number;
  updatedAt: string;
}

/** The Chat conversation asked from each cell, by cell key. */
export type CellChats = Record<string, string>;

export interface PaperTableRecord extends PaperTableSummary {
  columns: TableColumn[];
  cells: TableCells;
  leftOut: LeftOut;
  chats: CellChats;
}

export interface PaperTableChange {
  name?: string;
  columns?: TableColumn[];
  leaveOut?: Array<{ paperId: string; reason: string; columnId?: string }>;
  putBack?: string[];
}

interface TableRow {
  id: string;
  project_id: string;
  name: string;
  columns: unknown;
  cells: unknown;
  left_out: unknown;
  cell_chats: unknown;
  updated_at: string | Date;
}

/** A table that is not the caller's, or no longer exists; or a repository already holding the most tables. */
export class PaperTableError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409
  ) {
    super(message);
    this.name = "PaperTableError";
  }
}

function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function columnsOf(value: unknown): TableColumn[] {
  const parsed = ColumnsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function cellsOf(value: unknown): TableCells {
  return objectOf(value) as TableCells;
}

function leftOutOf(value: unknown): LeftOut {
  const out: LeftOut = {};
  for (const [paperId, entry] of Object.entries(objectOf(value))) {
    const { reason, columnId } = objectOf(entry);
    out[paperId] = { reason: typeof reason === "string" ? reason : "", ...(typeof columnId === "string" ? { columnId } : {}) };
  }
  return out;
}

function chatsOf(value: unknown): CellChats {
  return Object.fromEntries(Object.entries(objectOf(value)).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function record(row: TableRow): PaperTableRecord {
  const columns = columnsOf(row.columns);
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    columnCount: columns.length,
    updatedAt: iso(row.updated_at),
    columns,
    cells: cellsOf(row.cells),
    leftOut: leftOutOf(row.left_out),
    chats: chatsOf(row.cell_chats),
  };
}

export async function listTablesIn(client: Client, ownerUserId: string, projectId: string): Promise<PaperTableSummary[]> {
  const result = await client.query<TableRow>(
    `SELECT id, project_id, name, columns, '{}'::jsonb AS cells, '{}'::jsonb AS left_out, '{}'::jsonb AS cell_chats, updated_at
     FROM public.paper_tables WHERE owner_user_id = $1 AND project_id = $2 ORDER BY updated_at DESC LIMIT $3`,
    [ownerUserId, projectId, MAX_TABLES_PER_REPOSITORY]
  );
  return result.rows.map((row) => {
    const { columns: _columns, cells: _cells, leftOut: _leftOut, chats: _chats, ...summary } = record(row);
    return summary;
  });
}

export async function createTableIn(
  client: Client,
  ownerUserId: string,
  projectId: string,
  name: string,
  columns: TableColumn[]
): Promise<PaperTableRecord> {
  // The repository must be the caller's: row-level security on workspace_projects hides anyone else's.
  const project = await client.query(`SELECT 1 FROM public.workspace_projects WHERE id = $1 AND owner_user_id = $2`, [projectId, ownerUserId]);
  if (project.rows.length === 0) throw new PaperTableError("That repository was not found.", 404);
  const count = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM public.paper_tables WHERE owner_user_id = $1 AND project_id = $2`,
    [ownerUserId, projectId]
  );
  if (Number(count.rows[0]?.count ?? 0) >= MAX_TABLES_PER_REPOSITORY) {
    throw new PaperTableError(`A repository holds at most ${MAX_TABLES_PER_REPOSITORY} tables. Delete one to make another.`, 409);
  }
  const result = await client.query<TableRow>(
    `INSERT INTO public.paper_tables (owner_user_id, project_id, name, columns)
     VALUES ($1, $2, $3, $4::jsonb) RETURNING id, project_id, name, columns, cells, left_out, cell_chats, updated_at`,
    [ownerUserId, projectId, name, JSON.stringify(columns)]
  );
  return record(result.rows[0]);
}

const TABLE_SQL = `SELECT id, project_id, name, columns, cells, left_out, cell_chats, updated_at FROM public.paper_tables
  WHERE id = $1 AND owner_user_id = $2`;
const TABLE_FOR_UPDATE_SQL = `${TABLE_SQL} FOR UPDATE`;

export async function getTableIn(client: Client, ownerUserId: string, tableId: string, lock = false): Promise<PaperTableRecord> {
  const result = await client.query<TableRow>(lock ? TABLE_FOR_UPDATE_SQL : TABLE_SQL, [tableId, ownerUserId]);
  if (result.rows.length === 0) throw new PaperTableError("That table was not found.", 404);
  return record(result.rows[0]);
}

/**
 * Renames a table, changes its columns, or leaves papers out and puts them
 * back. A removed column's cells go, and a changed column's are read again;
 * a paper left out keeps its cells.
 */
export async function updateTableIn(client: Client, ownerUserId: string, tableId: string, change: PaperTableChange): Promise<PaperTableRecord> {
  const table = await getTableIn(client, ownerUserId, tableId, true);
  const columns = change.columns ?? table.columns;
  const cells = change.columns ? cellsForColumns(table.cells, table.columns, change.columns) : table.cells;
  const leftOut = change.leaveOut || change.putBack ? changeLeftOut(table.leftOut, change.leaveOut, change.putBack) : table.leftOut;
  const result = await client.query<TableRow>(
    `UPDATE public.paper_tables SET name = $3, columns = $4::jsonb, cells = $5::jsonb, left_out = $6::jsonb, updated_at = now()
     WHERE id = $1 AND owner_user_id = $2 RETURNING id, project_id, name, columns, cells, left_out, cell_chats, updated_at`,
    [tableId, ownerUserId, change.name ?? table.name, JSON.stringify(columns), JSON.stringify(cells), JSON.stringify(leftOut)]
  );
  return record(result.rows[0]);
}

/**
 * Adds a fill's cells to the table, key by key, in one statement, so batches
 * finishing together never overwrite each other. A cell for a column removed
 * while the fill ran is dropped.
 */
export async function mergeCellsIn(client: Client, ownerUserId: string, tableId: string, cells: TableCells): Promise<void> {
  const table = await getTableIn(client, ownerUserId, tableId, true);
  const columns = new Set(table.columns.map((column) => column.id));
  const kept = Object.fromEntries(Object.entries(cells).filter(([key]) => columns.has(key.slice(key.indexOf(":") + 1))));
  if (Object.keys(kept).length === 0) return;
  await client.query(
    `UPDATE public.paper_tables SET cells = cells || $3::jsonb, updated_at = now() WHERE id = $1 AND owner_user_id = $2`,
    [tableId, ownerUserId, JSON.stringify(kept)]
  );
}

/**
 * Records the Chat conversation asked from a cell, so the cell opens it
 * again. A question asked again from the cell after its conversation was
 * deleted starts a new one, which takes the old one's place.
 */
export async function linkCellChatIn(client: Client, ownerUserId: string, tableId: string, key: string, threadId: string): Promise<boolean> {
  const result = await client.query(
    `UPDATE public.paper_tables SET cell_chats = cell_chats || jsonb_build_object($3::text, $4::text)
     WHERE id = $1 AND owner_user_id = $2`,
    [tableId, ownerUserId, key, threadId]
  );
  return Boolean(result.rowCount);
}

export async function deleteTableIn(client: Client, ownerUserId: string, tableId: string): Promise<void> {
  const result = await client.query(`DELETE FROM public.paper_tables WHERE id = $1 AND owner_user_id = $2`, [tableId, ownerUserId]);
  if (!result.rowCount) throw new PaperTableError("That table was not found.", 404);
}

export const listPaperTables = (ownerUserId: string, projectId: string) =>
  withCloudSqlOwnerTransaction(ownerUserId, (client) => listTablesIn(client, ownerUserId, projectId));
export const createPaperTable = (ownerUserId: string, projectId: string, name: string, columns: TableColumn[]) =>
  withCloudSqlOwnerTransaction(ownerUserId, (client) => createTableIn(client, ownerUserId, projectId, name, columns));
export const getPaperTable = (ownerUserId: string, tableId: string) =>
  withCloudSqlOwnerTransaction(ownerUserId, (client) => getTableIn(client, ownerUserId, tableId));
export const updatePaperTable = (ownerUserId: string, tableId: string, change: PaperTableChange) =>
  withCloudSqlOwnerTransaction(ownerUserId, (client) => updateTableIn(client, ownerUserId, tableId, change));
export const mergePaperTableCells = (ownerUserId: string, tableId: string, cells: TableCells) =>
  withCloudSqlOwnerTransaction(ownerUserId, (client) => mergeCellsIn(client, ownerUserId, tableId, cells));
export const linkPaperTableChat = (ownerUserId: string, tableId: string, key: string, threadId: string) =>
  withCloudSqlOwnerTransaction(ownerUserId, (client) => linkCellChatIn(client, ownerUserId, tableId, key, threadId));
export const deletePaperTable = (ownerUserId: string, tableId: string) =>
  withCloudSqlOwnerTransaction(ownerUserId, (client) => deleteTableIn(client, ownerUserId, tableId));
