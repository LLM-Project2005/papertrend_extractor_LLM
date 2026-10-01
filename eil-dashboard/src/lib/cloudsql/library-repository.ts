import type { IngestionRunRow } from "@/types/database";
import type { PoolClient } from "pg";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { copyPaperAnalysis, movePaperRows, paperOfRun } from "@/lib/cloudsql/paper-copy";
import { isQuotaExemptRole } from "@/lib/quota-policy";
import { MAX_PAPERS_PER_ACCOUNT } from "@/lib/upload-safety";

/** A refusal with a reason for the reader and the HTTP status that goes with it. */
export class LibraryActionError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "LibraryActionError";
  }
}

/** A copy is a paper like any other, so it counts toward the account's papers. */
export async function assertRoomForAnotherPaper(client: Pick<PoolClient, "query">, ownerUserId: string): Promise<void> {
  const profile = await client.query<{ role: string | null }>(`SELECT role FROM public.user_profiles WHERE id=$1 LIMIT 1`, [ownerUserId]);
  if (isQuotaExemptRole(profile.rows[0]?.role)) return;
  const papers = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM public.papers WHERE owner_user_id = $1`, [ownerUserId]);
  if (Number(papers.rows[0]?.count ?? 0) + 1 > MAX_PAPERS_PER_ACCOUNT) {
    throw new LibraryActionError(
      `This account can store up to ${MAX_PAPERS_PER_ACCOUNT} papers, and a copy is one more. Delete papers permanently from Trash to make room.`,
      409
    );
  }
}

/**
 * Moves a run to a folder ($3) and records the folder's repository ($4) in its
 * payload. Readers prefer the folder's repository, but the payload kept the
 * old one, so anything reading it alone (the dashboard's count of papers in
 * progress) placed a moved paper in the repository it left.
 */
export const MOVE_RUN_SQL = `UPDATE public.ingestion_runs
   SET folder_id = $3,
       input_payload = CASE
         WHEN $4::text IS NULL THEN input_payload
         ELSE jsonb_set(COALESCE(input_payload, '{}'::jsonb), '{project_id}', to_jsonb($4::text))
       END,
       updated_at = now()
 WHERE id = $1 AND owner_user_id = $2
 RETURNING *`;

export interface LibraryRunListOptions {
  projectId?: string | null;
  includeTrashed?: boolean;
  logsOnly?: boolean;
  limit: number;
  offset: number;
}

export class CloudSqlLibraryRepository {
  async getRun(ownerUserId: string, runId: string): Promise<IngestionRunRow | null> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query<IngestionRunRow>(
        `SELECT * FROM public.ingestion_runs WHERE id = $1 AND owner_user_id = $2 LIMIT 1`,
        [runId, ownerUserId]
      );
      return result.rows[0] ?? null;
    });
  }

  async updateRun(
    ownerUserId: string,
    runId: string,
    patch: {
      displayName?: string;
      isFavorite?: boolean;
      folderId?: string | null;
      trashedAt?: string | null;
    }
  ): Promise<IngestionRunRow | null> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      if (patch.folderId) {
        const folder = await client.query<{ id: string }>(
          `
            SELECT id
            FROM public.research_folders
            WHERE id = $1 AND owner_user_id = $2
            LIMIT 1
          `,
          [patch.folderId, ownerUserId]
        );
        if (!folder.rows[0]) {
          throw new Error("Folder not found.");
        }
      }

      const values: unknown[] = [runId, ownerUserId];
      const assignments = ["updated_at = now()"];

      if (patch.displayName !== undefined) {
        values.push(patch.displayName);
        assignments.push(`display_name = $${values.length}`);
      }
      if (patch.isFavorite !== undefined) {
        values.push(patch.isFavorite);
        assignments.push(`is_favorite = $${values.length}`);
      }
      if (patch.folderId !== undefined) {
        values.push(patch.folderId);
        assignments.push(`folder_id = $${values.length}`);
      }
      if (patch.trashedAt !== undefined) {
        values.push(patch.trashedAt);
        assignments.push(`trashed_at = $${values.length}`);
      }

      const result = await client.query<IngestionRunRow>(
        `
          UPDATE public.ingestion_runs
          SET ${assignments.join(", ")}
          WHERE id = $1 AND owner_user_id = $2
          RETURNING *
        `,
        values
      );
      return result.rows[0] ?? null;
    });
  }

  async copyRun(ownerUserId: string, runId: string): Promise<IngestionRunRow> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const originalResult = await client.query<IngestionRunRow>(
        `
          SELECT *
          FROM public.ingestion_runs
          WHERE id = $1 AND owner_user_id = $2
          LIMIT 1
        `,
        [runId, ownerUserId]
      );
      const original = originalResult.rows[0];
      if (!original) {
        throw new Error("File not found.");
      }
      // The copy gets its own analysis (docs/32, 2.5): a copy that was only a
      // second run row had no content of its own, so the dashboard, chat and
      // semantic map never showed it, and a correction to it changed nothing.
      const sourcePaperId = await paperOfRun(client, ownerUserId, runId);
      if (!sourcePaperId) {
        throw new LibraryActionError("Only a paper that has been analysed can be copied.", 409);
      }
      await assertRoomForAnotherPaper(client, ownerUserId);

      const displayName =
        original.display_name?.trim() || original.source_filename?.trim() || "File";
      const copy = await client.query<IngestionRunRow>(
        `
          INSERT INTO public.ingestion_runs (
            owner_user_id,
            folder_id,
            source_type,
            status,
            source_filename,
            display_name,
            source_path,
            source_extension,
            mime_type,
            file_size_bytes,
            provider,
            model,
            is_favorite,
            copied_from_run_id,
            input_payload
          )
          -- The payload is copied inside the database: read into JavaScript
          -- and written back, its 60-bit paper_id came out rounded.
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, $13,
            COALESCE(
              (SELECT source.input_payload FROM public.ingestion_runs source WHERE source.id = $13 AND source.owner_user_id = $1),
              '{}'::jsonb
            )
          )
          RETURNING *
        `,
        [
          ownerUserId,
          original.folder_id ?? null,
          original.source_type,
          original.status,
          original.source_filename ?? null,
          `${displayName} copy`,
          original.source_path ?? null,
          original.source_extension ?? null,
          original.mime_type ?? null,
          original.file_size_bytes ?? null,
          original.provider ?? null,
          original.model ?? null,
          runId,
        ]
      );

      const created = copy.rows[0];
      if (!created) {
        throw new Error("Failed to copy file.");
      }
      await copyPaperAnalysis(client, { ownerUserId, fromPaperId: sourcePaperId, toRunId: String(created.id) });
      const copied = await client.query<IngestionRunRow>(
        `SELECT * FROM public.ingestion_runs WHERE id = $1 AND owner_user_id = $2`,
        [created.id, ownerUserId]
      );
      return copied.rows[0] ?? created;
    });
  }

  /**
   * Moves a paper to another folder of the same owner, with its analysis rows
   * and its search index, so the folder and repository it lands in count and
   * search it.
   */
  async moveRun(ownerUserId: string, runId: string, folderId: string): Promise<IngestionRunRow | null> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const folder = await client.query<{ project_id: string | null }>(
        `SELECT project_id::text AS project_id FROM public.research_folders WHERE id = $1 AND owner_user_id = $2`,
        [folderId, ownerUserId]
      );
      if (!folder.rows[0]) throw new LibraryActionError("Folder not found.", 404);
      const moved = await client.query<IngestionRunRow>(MOVE_RUN_SQL, [runId, ownerUserId, folderId, folder.rows[0].project_id]);
      if (!moved.rows[0]) return null;
      const paperId = await paperOfRun(client, ownerUserId, runId);
      if (paperId) {
        await movePaperRows(client, { ownerUserId, paperId, folderId, projectId: folder.rows[0].project_id });
      }
      return moved.rows[0];
    });
  }

  async listRuns(
    ownerUserId: string,
    options: LibraryRunListOptions
  ): Promise<IngestionRunRow[]> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const values: unknown[] = [ownerUserId];
      const conditions = ["r.owner_user_id = $1"];

      if (options.projectId) {
        const folders = await client.query<{ id: string }>(
          `
            SELECT id
            FROM public.research_folders
            WHERE owner_user_id = $1 AND project_id = $2
          `,
          [ownerUserId, options.projectId]
        );

        if (folders.rows.length === 0) {
          return [];
        }

        values.push(folders.rows.map((folder) => folder.id));
        conditions.push(`r.folder_id = ANY($${values.length}::uuid[])`);
      }

      if (!options.includeTrashed) {
        conditions.push("r.trashed_at IS NULL");
      }

      if (options.logsOnly) {
        conditions.push("r.status IN ('succeeded', 'failed')");
      }

      values.push(options.limit, options.offset);
      // The paper's title is joined in so the Library can name a paper by its
      // title rather than by the file it arrived in. It is found through the
      // run's own content row, as the paper view finds it: input_payload's
      // paper_id is a 60-bit number, and any JavaScript that read the payload
      // and wrote it back rounded it to a different id.
      const result = await client.query<IngestionRunRow>(
        `
          SELECT r.*, paper.title AS paper_title
          FROM public.ingestion_runs r
          LEFT JOIN LATERAL (
            SELECT p.title
            FROM public.paper_content c
            JOIN public.papers p ON p.id = c.paper_id AND p.owner_user_id = c.owner_user_id
            WHERE c.owner_user_id = r.owner_user_id AND c.ingestion_run_id = r.id
            LIMIT 1
          ) paper ON true
          WHERE ${conditions.join(" AND ")}
          ORDER BY r.updated_at DESC NULLS LAST
          LIMIT $${values.length - 1}
          OFFSET $${values.length}
        `,
        values
      );

      return result.rows;
    });
  }
}

export const cloudSqlLibraryRepository = new CloudSqlLibraryRepository();
