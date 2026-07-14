import type { IngestionRunRow } from "@/types/database";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";

export interface LibraryRunListOptions {
  projectId?: string | null;
  includeTrashed?: boolean;
  logsOnly?: boolean;
  limit: number;
  offset: number;
}

export class CloudSqlLibraryRepository {
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
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, false, $13, $14)
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
          original.input_payload ?? {},
        ]
      );

      const created = copy.rows[0];
      if (!created) {
        throw new Error("Failed to copy file.");
      }
      return created;
    });
  }

  async listRuns(
    ownerUserId: string,
    options: LibraryRunListOptions
  ): Promise<IngestionRunRow[]> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const values: unknown[] = [ownerUserId];
      const conditions = ["owner_user_id = $1"];

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
        conditions.push(`folder_id = ANY($${values.length}::uuid[])`);
      }

      if (!options.includeTrashed) {
        conditions.push("trashed_at IS NULL");
      }

      if (options.logsOnly) {
        conditions.push("status IN ('succeeded', 'failed')");
      }

      values.push(options.limit, options.offset);
      const result = await client.query<IngestionRunRow>(
        `
          SELECT *
          FROM public.ingestion_runs
          WHERE ${conditions.join(" AND ")}
          ORDER BY updated_at DESC NULLS LAST
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
