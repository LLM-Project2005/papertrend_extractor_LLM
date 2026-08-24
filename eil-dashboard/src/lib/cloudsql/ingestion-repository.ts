import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import type { IngestionRunRow } from "@/types/database";
import { MAX_PAPERS_PER_ACCOUNT } from "@/lib/upload-safety";

export type IngestionJobRow = Record<string, unknown> & { id: string };

export class UploadPolicyError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
    this.name = "UploadPolicyError";
  }
}

export class CloudSqlIngestionRepository {
  async createUploadBatch(input: {
    ownerUserId: string;
    folderId: string;
    files: Array<{ name: string; size: number; type?: string | null; sha256?: string | null }>;
    folderName: string;
    sourceKind: string;
    provider: string;
    model: string;
    analysisLabel: string;
  }): Promise<{ folderJob: IngestionJobRow; runs: IngestionRunRow[] }> {
    return withCloudSqlOwnerTransaction(input.ownerUserId, async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
        `paper-upload:${input.ownerUserId}`,
      ]);

      const folder = await client.query<{ id: string }>(
        `SELECT id FROM public.research_folders WHERE id = $1 AND owner_user_id = $2`,
        [input.folderId, input.ownerUserId]
      );
      if (!folder.rows[0]) throw new Error("Folder not found.");

      const accountUsage = await client.query<{ count: string }>(
        `
          SELECT (
            (SELECT count(*) FROM public.papers WHERE owner_user_id = $1) +
            (SELECT count(*) FROM public.ingestion_runs
             WHERE owner_user_id = $1
               AND copied_from_run_id IS NULL
               AND trashed_at IS NULL
               AND status IN ('queued', 'processing')
               AND NOT EXISTS (
                 SELECT 1 FROM public.paper_content pc
                 WHERE pc.owner_user_id = $1 AND pc.ingestion_run_id = ingestion_runs.id
               ))
          )::text AS count
        `,
        [input.ownerUserId]
      );
      const activePaperCount = Number(accountUsage.rows[0]?.count ?? 0);
      if (activePaperCount + input.files.length > MAX_PAPERS_PER_ACCOUNT) {
        const remaining = Math.max(0, MAX_PAPERS_PER_ACCOUNT - activePaperCount);
        throw new UploadPolicyError(
          `This account can store up to ${MAX_PAPERS_PER_ACCOUNT} papers. ${activePaperCount} are already active, so only ${remaining} more can be uploaded.`,
          429
        );
      }

      const hashes = input.files.map((file) => file.sha256?.toLowerCase()).filter(Boolean) as string[];
      const repeatedHashes = hashes.filter((hash, index) => hashes.indexOf(hash) !== index);
      if (repeatedHashes.length > 0) {
        const repeatedNames = input.files
          .filter((file) => repeatedHashes.includes(file.sha256?.toLowerCase() ?? ""))
          .map((file) => file.name);
        throw new UploadPolicyError(
          `The same PDF was selected more than once: ${Array.from(new Set(repeatedNames)).join(", ")}.`,
          409
        );
      }
      const duplicateFingerprints = hashes.length > 0
        ? await client.query<{ sha256: string; source_filename: string | null }>(
            `
              SELECT f.sha256, COALESCE(r.display_name, r.source_filename, f.source_filename) AS source_filename
              FROM public.file_fingerprints f
              JOIN public.ingestion_runs r
                ON r.id = f.latest_run_id AND r.owner_user_id = f.owner_user_id
              WHERE f.owner_user_id = $1
                AND f.sha256 = ANY($2::text[])
                AND r.status = 'succeeded'
                AND EXISTS (
                  SELECT 1
                  FROM public.paper_content pc
                  WHERE pc.owner_user_id = f.owner_user_id
                    AND pc.ingestion_run_id = r.id
                )
            `,
            [input.ownerUserId, hashes]
          )
        : { rows: [] as Array<{ sha256: string; source_filename: string | null }> };

      const legacyDuplicates = await client.query<{ source_filename: string | null }>(
        `
          SELECT COALESCE(display_name, source_filename) AS source_filename
          FROM public.ingestion_runs
          WHERE owner_user_id = $1
            AND status = 'succeeded'
            AND EXISTS (
              SELECT 1
              FROM public.paper_content pc
              WHERE pc.owner_user_id = ingestion_runs.owner_user_id
                AND pc.ingestion_run_id = ingestion_runs.id
            )
            AND EXISTS (
              SELECT 1
              FROM unnest($2::text[], $3::bigint[]) AS incoming(name, size)
              WHERE lower(COALESCE(ingestion_runs.source_filename, '')) = lower(incoming.name)
                AND COALESCE(ingestion_runs.file_size_bytes, 0) = incoming.size
            )
        `,
        [input.ownerUserId, input.files.map((file) => file.name), input.files.map((file) => file.size)]
      );
      const duplicateNames = new Set([
        ...duplicateFingerprints.rows.map((row) => row.source_filename).filter(Boolean),
        ...legacyDuplicates.rows.map((row) => row.source_filename).filter(Boolean),
      ] as string[]);
      if (duplicateNames.size > 0) {
        throw new UploadPolicyError(
          `Already analyzed in this account: ${Array.from(duplicateNames).slice(0, 5).join(", ")}. Remove the duplicate selection or restore the existing paper instead.`,
          409
        );
      }

      const jobResult = await client.query<IngestionJobRow>(
        `
          INSERT INTO public.folder_analysis_jobs (
            owner_user_id, folder_id, status, total_runs, queued_runs,
            processing_runs, progress_stage, progress_message, progress_detail
          ) VALUES ($1, $2, 'queued', $3, 0, $3, 'uploading',
            'Uploading files', $4)
          RETURNING *
        `,
        [
          input.ownerUserId,
          input.folderId,
          input.files.length,
          `Uploading ${input.files.length} file${input.files.length === 1 ? "" : "s"} to storage before queueing analysis.`,
        ]
      );
      const folderJob = jobResult.rows[0];
      if (!folderJob) throw new Error("Failed to create folder analysis job.");

      const runs: IngestionRunRow[] = [];
      for (const file of input.files) {
        const result = await client.query<IngestionRunRow>(
          `
            INSERT INTO public.ingestion_runs (
              owner_user_id, folder_id, folder_analysis_job_id, source_type,
              status, source_filename, display_name, source_extension, mime_type,
              file_size_bytes, provider, model, input_payload
            ) VALUES ($1, $2, $3, 'upload', 'processing', $4, $4, $5, $6, $7, $8, $9, $10)
            RETURNING *
          `,
          [
            input.ownerUserId,
            input.folderId,
            folderJob.id,
            file.name,
            file.name.toLowerCase().split(".").pop() ?? "pdf",
            file.type || "application/pdf",
            file.size,
            input.provider,
            input.model,
            {
              uploaded_from: "/workspace/imports",
              folder_name: input.folderName,
              source_kind: input.sourceKind,
              original_size: file.size,
              mime_type: file.type || "application/pdf",
              analysis_mode: "automatic",
              analysis_label: input.analysisLabel,
              progress_stage: "uploading",
              progress_message: "Uploading",
              progress_detail: "Uploading file directly to storage before queueing analysis.",
            },
          ]
        );
        if (!result.rows[0]) throw new Error(`Failed to create run for ${file.name}`);
        runs.push(result.rows[0]);
        if (file.sha256) {
          await client.query(
            `
              INSERT INTO public.file_fingerprints (
                owner_user_id, sha256, file_size_bytes, mime_type,
                source_filename, latest_run_id, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, now())
              ON CONFLICT (owner_user_id, sha256) DO UPDATE SET
                file_size_bytes = EXCLUDED.file_size_bytes,
                mime_type = EXCLUDED.mime_type,
                source_filename = EXCLUDED.source_filename,
                latest_run_id = EXCLUDED.latest_run_id,
                updated_at = now()
            `,
            [
              input.ownerUserId,
              file.sha256.toLowerCase(),
              file.size,
              file.type || "application/pdf",
              file.name,
              result.rows[0].id,
            ]
          );
        }
      }
      return { folderJob, runs };
    });
  }

  async loadOwnedBatch(ownerUserId: string, folderJobId: string, runIds: string[]) {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query<IngestionRunRow>(
        `SELECT * FROM public.ingestion_runs
         WHERE owner_user_id = $1 AND folder_analysis_job_id = $2 AND id = ANY($3::uuid[])`,
        [ownerUserId, folderJobId, runIds]
      );
      return result.rows;
    });
  }

  async finalizeBatch(input: {
    ownerUserId: string;
    folderJobId: string;
    uploaded: Array<{ runId: string; storagePath: string }>;
    failed: Array<{ runId: string; errorMessage?: string }>;
  }): Promise<{ folderJob: IngestionJobRow; runs: IngestionRunRow[] }> {
    return withCloudSqlOwnerTransaction(input.ownerUserId, async (client) => {
      const timestamp = new Date().toISOString();
      for (const item of input.uploaded) {
        const result = await client.query(
          `UPDATE public.ingestion_runs
           SET status = 'queued', source_path = $4, error_message = NULL,
               completed_at = NULL, updated_at = $5,
               input_payload = COALESCE(input_payload, '{}'::jsonb) || $6::jsonb
           WHERE id = $1 AND owner_user_id = $2 AND folder_analysis_job_id = $3`,
          [item.runId, input.ownerUserId, input.folderJobId, item.storagePath, timestamp,
            JSON.stringify({ progress_stage: "queued", progress_message: "Queued", progress_detail: "Upload complete. Waiting for worker to claim this file.", uploaded_at: timestamp })]
        );
        if (result.rowCount !== 1) {
          throw new Error(`Upload finalization did not match run ${item.runId}.`);
        }
      }
      for (const item of input.failed) {
        const message = item.errorMessage || "Direct upload failed before queueing.";
        const result = await client.query(
          `UPDATE public.ingestion_runs
           SET status = 'failed', error_message = $4, completed_at = $5,
               updated_at = $5, input_payload = COALESCE(input_payload, '{}'::jsonb) || $6::jsonb
           WHERE id = $1 AND owner_user_id = $2 AND folder_analysis_job_id = $3`,
          [item.runId, input.ownerUserId, input.folderJobId, message, timestamp,
            JSON.stringify({ progress_stage: "failed", progress_message: "Upload failed", progress_detail: message, upload_failed_at: timestamp })]
        );
        if (result.rowCount !== 1) {
          throw new Error(`Upload failure finalization did not match run ${item.runId}.`);
        }
      }
      const queuedCount = input.uploaded.length;
      const failedCount = input.failed.length;
      const job = await client.query<IngestionJobRow>(
        `UPDATE public.folder_analysis_jobs
         SET status = $3, queued_runs = $4, processing_runs = 0, failed_runs = $5,
             progress_stage = $3, progress_message = $6, progress_detail = $7,
             updated_at = $8, completed_at = $9
         WHERE id = $1 AND owner_user_id = $2 AND folder_id IN (
           SELECT id FROM public.research_folders WHERE owner_user_id = $2
         ) RETURNING *`,
        [input.folderJobId, input.ownerUserId,
          queuedCount > 0 ? "queued" : "failed", queuedCount, failedCount,
          queuedCount > 0 ? "Queued" : "Upload failed before queueing",
          queuedCount > 0 ? `Queued ${queuedCount} file${queuedCount === 1 ? "" : "s"} for processing.` : "All files in this batch failed during upload.",
          timestamp, queuedCount > 0 ? null : timestamp]
      );
      if (!job.rows[0]) throw new Error("Folder analysis job not found.");
      const runs = await client.query<IngestionRunRow>(
        `SELECT * FROM public.ingestion_runs WHERE owner_user_id = $1 AND folder_analysis_job_id = $2 ORDER BY created_at DESC`,
        [input.ownerUserId, input.folderJobId]
      );
      const invalidQueuedRun = runs.rows.find(
        (run) => run.status === "queued" && !String(run.source_path ?? "").trim()
      );
      if (invalidQueuedRun) {
        throw new Error(`Queued run ${invalidQueuedRun.id} is missing its storage path.`);
      }
      return { folderJob: job.rows[0], runs: runs.rows };
    });
  }

  async persistWorkerStartState(input: {
    ownerUserId: string;
    runIds: string[];
    folderJobId: string;
    progressStage: string;
    progressMessage: string;
    progressDetail: string;
    metadata: Record<string, unknown>;
  }) {
    return withCloudSqlOwnerTransaction(input.ownerUserId, async (client) => {
      const patch = JSON.stringify({
        progress_stage: input.progressStage,
        progress_message: input.progressMessage,
        progress_detail: input.progressDetail,
        progress_updated_at: new Date().toISOString(),
        ...input.metadata,
      });
      await client.query(
        `UPDATE public.ingestion_runs SET updated_at = now(),
         input_payload = COALESCE(input_payload, '{}'::jsonb) || $3::jsonb
         WHERE owner_user_id = $1 AND id = ANY($2::uuid[])`,
        [input.ownerUserId, input.runIds, patch]
      );
      await client.query(
        `UPDATE public.folder_analysis_jobs SET updated_at = now(), progress_stage = $3,
         progress_message = $4, progress_detail = $5
         WHERE id = $1 AND owner_user_id = $2`,
        [input.folderJobId, input.ownerUserId, input.progressStage, input.progressMessage, input.progressDetail]
      );
    });
  }
}

export const cloudSqlIngestionRepository = new CloudSqlIngestionRepository();
