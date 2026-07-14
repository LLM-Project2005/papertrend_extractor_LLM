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
