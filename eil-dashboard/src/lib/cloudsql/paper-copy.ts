import type { PoolClient } from "pg";

/**
 * A paper's analysis lives in these tables - the worker writes them together
 * (worker/analysis_pipeline/persistence.py, `paper_write_steps`). A copy of a
 * paper gets its own set, under its own paper id (docs/32, 2.5).
 */
export const PAPER_TABLES = [
  "papers",
  "paper_tracks_single",
  "paper_tracks_multi",
  "paper_content",
  "paper_keywords",
  "paper_keyword_concepts",
  "paper_analysis_facets",
  "paper_author_keywords",
  "paper_research_typologies",
  "paper_category_definitions",
  "paper_category_assignments",
] as const;

/**
 * The paper id the worker gives a run (`paperIdFromRunId`, nodes/common.py
 * `infer_paper_id`): the first 15 hex digits of the run id. Computed in SQL so
 * the 60-bit number is never rounded by JavaScript.
 */
export function paperIdFromRunSql(runIdParam: string): string {
  return `('x' || left(replace(${runIdParam}::text, '-', ''), 15))::bit(60)::bigint`;
}

type Client = Pick<PoolClient, "query">;

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected column name: ${name}`);
  return `"${name}"`;
}

/** The paper whose analysis a run owns, or null when it has none of its own. */
export async function paperOfRun(client: Client, ownerUserId: string, runId: string): Promise<string | null> {
  const result = await client.query<{ paper_id: string }>(
    `SELECT paper_id::text AS paper_id FROM public.paper_content
     WHERE owner_user_id = $1 AND ingestion_run_id = $2 LIMIT 1`,
    [ownerUserId, runId]
  );
  return result.rows[0]?.paper_id ?? null;
}

/**
 * Copies a paper's analysis to the paper of `toRunId`: every row of every
 * paper table, with the copy's paper id and, in its content row, the copy's
 * run. The column lists come from the database itself, so a column added
 * later is copied too; ids the database generates are generated afresh.
 */
export async function copyPaperAnalysis(
  client: Client,
  input: { ownerUserId: string; fromPaperId: string; toRunId: string }
): Promise<void> {
  const newId = paperIdFromRunSql("$3");
  for (const table of PAPER_TABLES) {
    const columns = await client.query<{
      column_name: string;
      column_default: string | null;
      is_generated: string;
      is_identity: string;
    }>(
      `SELECT column_name, column_default, is_generated, is_identity
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [table]
    );
    const key = table === "papers" ? "id" : "paper_id";
    const copied = columns.rows.filter(
      (column) =>
        column.is_generated !== "ALWAYS" &&
        column.is_identity !== "YES" &&
        // A serial id gets a fresh value; the paper's own id is set below.
        !(column.column_name === "id" && table !== "papers" && column.column_default)
    );
    if (copied.length === 0) continue;
    const values = copied.map((column) => {
      if (column.column_name === key) return newId;
      if (table === "paper_content" && column.column_name === "ingestion_run_id") return "$3::uuid";
      if (column.column_name === "created_at" || column.column_name === "updated_at") return "now()";
      return `src.${ident(column.column_name)}`;
    });
    await client.query(
      `INSERT INTO public.${table} (${copied.map((column) => ident(column.column_name)).join(", ")})
       SELECT ${values.join(", ")}
       FROM public.${table} src
       WHERE src.${key} = $2::bigint AND src.owner_user_id = $1`,
      [input.ownerUserId, input.fromPaperId, input.toRunId]
    );
  }
  // Only the parameters it uses: Postgres refuses a parameter whose type it cannot tell.
  await client.query(
    `UPDATE public.ingestion_runs
     SET input_payload = jsonb_set(COALESCE(input_payload, '{}'::jsonb), '{paper_id}', to_jsonb(${paperIdFromRunSql("$2")}))
     WHERE id = $2 AND owner_user_id = $1`,
    [input.ownerUserId, input.toRunId]
  );
}

/**
 * Moves a paper's rows with its run: the paper tables and the search index
 * carry the folder (and the index the repository), and a paper whose rows
 * still named the old folder was searched, and counted, there.
 */
export async function movePaperRows(
  client: Client,
  input: { ownerUserId: string; paperId: string; folderId: string; projectId: string | null }
): Promise<void> {
  for (const table of PAPER_TABLES) {
    const key = table === "papers" ? "id" : "paper_id";
    const hasFolder = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'folder_id'`,
      [table]
    );
    if (!hasFolder.rows.length) continue;
    await client.query(
      `UPDATE public.${table} SET folder_id = $3 WHERE ${key} = $2::bigint AND owner_user_id = $1`,
      [input.ownerUserId, input.paperId, input.folderId]
    );
  }
  for (const table of ["paper_retrieval_chunks", "paper_retrieval_documents"]) {
    await client.query(
      `UPDATE public.${table} SET folder_id = $3, project_id = $4 WHERE paper_id = $2::bigint AND owner_user_id = $1`,
      [input.ownerUserId, input.paperId, input.folderId, input.projectId]
    );
  }
}
