import type { PoolClient } from "pg";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import type { IngestionRunRow } from "@/types/database";
import { MAX_PAPERS_PER_ACCOUNT } from "@/lib/upload-safety";
import { isQuotaExemptRole } from "@/lib/quota-policy";
import { DEPLOYMENT_KEY, deploymentEnv } from "@/lib/deployment";

export type IngestionJobRow = Record<string, unknown> & { id: string };

/** A file left out of an upload, and why; `position` is its place in the request. */
export interface UploadSkip {
  position: number;
  name: string;
  reason: string;
}

export class UploadPolicyError extends Error {
  constructor(message: string, readonly status = 409, readonly skipped: UploadSkip[] = []) {
    super(message);
    this.name = "UploadPolicyError";
  }
}

/**
 * The papers an account holds against its limit: stored papers (Trash
 * included) and uploads still on their way to being one. Shown before an
 * upload, and checked when one is prepared (docs/32, 4.5).
 */
export async function accountPaperUsageIn(
  client: Pick<PoolClient, "query">,
  ownerUserId: string
): Promise<{ used: number; limit: number; exempt: boolean }> {
  const profile = await client.query<{ role: string | null }>(`SELECT role FROM public.user_profiles WHERE id=$1 LIMIT 1`, [ownerUserId]);
  const usage = await client.query<{ count: string }>(
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
    [ownerUserId]
  );
  return {
    used: Number(usage.rows[0]?.count ?? 0),
    limit: MAX_PAPERS_PER_ACCOUNT,
    exempt: isQuotaExemptRole(profile.rows[0]?.role),
  };
}

export type UploadBatchInput = {
  ownerUserId: string;
  projectId: string;
  folderId: string;
  files: Array<{
    name: string;
    size: number;
    type?: string | null;
    sha256?: string | null;
    /** Picked in Google Drive (recorded so the Library can say so; audit LIB-7). */
    driveFileId?: string | null;
  }>;
  folderName: string;
  sourceKind: string;
  provider: string;
  model: string;
  analysisLabel: string;
  analysisProfile?: unknown;
};

/** The body of createUploadBatch, in the caller's owner-scoped transaction (tests run it in PGlite). */
export async function createUploadBatchIn(
  client: Pick<PoolClient, "query">,
  input: UploadBatchInput
): Promise<{ folderJob: IngestionJobRow; runs: IngestionRunRow[]; acceptedPositions: number[]; skipped: UploadSkip[] }> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `paper-upload:${input.ownerUserId}`,
  ]);

  const folder = await client.query<{ id: string }>(
    `SELECT id FROM public.research_folders WHERE id = $1 AND owner_user_id = $2`,
    [input.folderId, input.ownerUserId]
  );
  if (!folder.rows[0]) throw new Error("Folder not found.");

  // Which files go ahead (docs/32, 4.5). A file picked twice keeps its
  // first copy, and a file already analysed in this account is skipped
  // with its reason: either used to reject the whole batch, so one
  // repeat among fifty stopped all fifty.
  const skipped: UploadSkip[] = [];
  const seenHashes = new Set<string>();
  const unique = input.files
    .map((file, position) => ({ file, position, hash: file.sha256?.toLowerCase() || null }))
    .filter((candidate) => {
      if (!candidate.hash) return true;
      if (seenHashes.has(candidate.hash)) {
        skipped.push({ position: candidate.position, name: candidate.file.name, reason: "It was chosen more than once; one copy is uploaded." });
        return false;
      }
      seenHashes.add(candidate.hash);
      return true;
    });
  const hashes = unique.map((candidate) => candidate.hash).filter((hash): hash is string => Boolean(hash));
  const byHash = new Map<string, string>();
  if (hashes.length > 0) {
    const duplicateFingerprints = await client.query<{ sha256: string; source_filename: string | null }>(
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
    );
    for (const row of duplicateFingerprints.rows) byHash.set(row.sha256.toLowerCase(), row.source_filename ?? "an earlier upload");
  }
  // Older uploads have no fingerprint: the same name and size is the match.
  const legacyDuplicates = await client.query<{ name: string; size: string; existing: string | null }>(
    `
      SELECT DISTINCT ON (incoming.position) incoming.name, incoming.size::text AS size,
             COALESCE(r.display_name, r.source_filename) AS existing
      FROM unnest($2::text[], $3::bigint[]) WITH ORDINALITY AS incoming(name, size, position)
      JOIN public.ingestion_runs r
        ON lower(COALESCE(r.source_filename, '')) = lower(incoming.name)
       AND COALESCE(r.file_size_bytes, 0) = incoming.size
      WHERE r.owner_user_id = $1
        AND r.status = 'succeeded'
        AND EXISTS (
          SELECT 1
          FROM public.paper_content pc
          WHERE pc.owner_user_id = r.owner_user_id
            AND pc.ingestion_run_id = r.id
        )
      ORDER BY incoming.position
    `,
    [input.ownerUserId, unique.map((candidate) => candidate.file.name), unique.map((candidate) => candidate.file.size)]
  );
  const byNameAndSize = new Map(
    legacyDuplicates.rows.map((row) => [`${row.name.toLowerCase()}:${row.size}`, row.existing ?? row.name])
  );
  const accepted = unique.filter((candidate) => {
    const existing =
      (candidate.hash ? byHash.get(candidate.hash) : undefined) ??
      byNameAndSize.get(`${candidate.file.name.toLowerCase()}:${candidate.file.size}`);
    if (existing === undefined) return true;
    skipped.push({ position: candidate.position, name: candidate.file.name, reason: `Already analyzed in this account as "${existing}".` });
    return false;
  });
  skipped.sort((left, right) => left.position - right.position);
  if (accepted.length === 0) {
    throw new UploadPolicyError(
      skipped.length === 1
        ? `"${skipped[0].name}" is already in this account, so there was nothing new to upload.`
        : `All ${skipped.length} files are already in this account or repeat each other, so there was nothing new to upload.`,
      409,
      skipped
    );
  }

  // The limit counts what will be stored, so a skipped duplicate takes no room.
  const usage = await accountPaperUsageIn(client, input.ownerUserId);
  if (!usage.exempt && usage.used + accepted.length > MAX_PAPERS_PER_ACCOUNT) {
    const remaining = Math.max(0, MAX_PAPERS_PER_ACCOUNT - usage.used);
    throw new UploadPolicyError(
      `This account can store up to ${MAX_PAPERS_PER_ACCOUNT} papers. ${usage.used} are already stored, including any in Trash, so only ${remaining} more can be uploaded. Delete papers permanently from Trash to make room.`,
      429
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
      accepted.length,
      `Uploading ${accepted.length} file${accepted.length === 1 ? "" : "s"} to storage before queueing analysis.`,
    ]
  );
  const folderJob = jobResult.rows[0];
  if (!folderJob) throw new Error("Failed to create folder analysis job.");

  const runs: IngestionRunRow[] = [];
  for (const { file } of accepted) {
    const fromDrive = typeof file.driveFileId === "string" && /^[A-Za-z0-9_-]{10,200}$/.test(file.driveFileId);
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
          project_id: input.projectId,
          source_kind: input.sourceKind,
          original_size: file.size,
          mime_type: file.type || "application/pdf",
          analysis_mode: "automatic",
          analysis_label: input.analysisLabel,
          analysis_profile: input.analysisProfile ?? null,
          [DEPLOYMENT_KEY]: deploymentEnv(),
          // Not source_kind: the worker reads "google-drive" there as a
          // connector download. The file itself arrives as any upload does.
          import_source: fromDrive ? "google-drive" : "computer",
          ...(fromDrive ? { drive_file_id: file.driveFileId } : {}),
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
  return { folderJob, runs, acceptedPositions: accepted.map((candidate) => candidate.position), skipped };
}

export class CloudSqlIngestionRepository {
  async createUploadBatch(input: UploadBatchInput): Promise<{ folderJob: IngestionJobRow; runs: IngestionRunRow[]; acceptedPositions: number[]; skipped: UploadSkip[] }> {
    return withCloudSqlOwnerTransaction(input.ownerUserId, (client) => createUploadBatchIn(client, input));
  }

  async listRecentRuns(ownerUserId: string, limit = 25): Promise<IngestionRunRow[]> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query<IngestionRunRow>(
        `SELECT id, owner_user_id, folder_id, folder_analysis_job_id, source_type, status,
                source_filename, display_name, source_extension, mime_type, file_size_bytes,
                provider, model, input_payload, error_message, created_at, updated_at, completed_at
         FROM public.ingestion_runs
         WHERE owner_user_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [ownerUserId, Math.max(1, Math.min(limit, 100))]
      );
      return result.rows;
    });
  }

  /**
   * Marks this owner's uploads that were prepared but never finalized, and are
   * older than `olderThanMinutes`, as failed, and returns their ids so their
   * stored files can be deleted. A signed upload URL lives 15 minutes, so a run
   * still waiting after an hour can no longer be finished. Owner-scoped: it
   * only ever touches the caller's own runs.
   */
  /** The papers this account holds against its limit (docs/32, 4.5). */
  async accountPaperUsage(ownerUserId: string): Promise<{ used: number; limit: number; exempt: boolean }> {
    return withCloudSqlOwnerTransaction(ownerUserId, (client) => accountPaperUsageIn(client, ownerUserId));
  }

  /**
   * An upload of this owner's batch still waiting for its file: the only kind
   * whose upload URL may be signed again (docs/32, 4.5; audit LIB-8). Older
   * than an hour, failAbandonedUploads has closed it.
   */
  async pendingUploadRun(
    ownerUserId: string,
    folderJobId: string,
    runId: string
  ): Promise<{ id: string; mime_type: string | null } | null> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query<{ id: string; mime_type: string | null }>(
        `SELECT id::text AS id, mime_type FROM public.ingestion_runs
         WHERE id = $1 AND owner_user_id = $2 AND folder_analysis_job_id = $3
           AND source_type = 'upload' AND status = 'processing'
           AND source_path IS NULL AND trashed_at IS NULL
           AND created_at > now() - interval '60 minutes'`,
        [runId, ownerUserId, folderJobId]
      );
      return result.rows[0] ?? null;
    });
  }

  async failAbandonedUploads(ownerUserId: string, olderThanMinutes = 60): Promise<string[]> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE public.ingestion_runs
         SET status = 'failed', error_message = 'The upload was never completed.',
             completed_at = now(), updated_at = now(),
             input_payload = COALESCE(input_payload, '{}'::jsonb)
               || jsonb_build_object('progress_stage', 'failed', 'progress_message', 'Upload never completed')
         WHERE owner_user_id = $1 AND source_type = 'upload'
           AND status = 'processing' AND source_path IS NULL
           AND created_at < now() - make_interval(mins => $2::int)
         RETURNING id`,
        [ownerUserId, olderThanMinutes]
      );
      return result.rows.map((row) => String(row.id));
    });
  }

  /**
   * The runs of an upload batch that are still waiting to be finalized.
   *
   * A run is only awaiting finalization while prepare left it: 'processing'
   * with no stored path. Without that condition, finalize could be replayed
   * over any run at any time, which re-queued finished work and let one
   * account analyse far more papers than its quota allows. Replaying now
   * matches nothing, so a browser retry stays harmless.
   */
  async loadOwnedBatch(ownerUserId: string, folderJobId: string, runIds: string[]) {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query<IngestionRunRow>(
        `SELECT * FROM public.ingestion_runs
         WHERE owner_user_id = $1 AND folder_analysis_job_id = $2 AND id = ANY($3::uuid[])
           AND status = 'processing' AND source_path IS NULL`,
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
           WHERE id = $1 AND owner_user_id = $2 AND folder_analysis_job_id = $3
             AND status = 'processing' AND source_path IS NULL`,
          [item.runId, input.ownerUserId, input.folderJobId, item.storagePath, timestamp,
            JSON.stringify({ progress_stage: "queued", progress_message: "Queued", progress_detail: "Upload complete. Waiting for worker to claim this file.", uploaded_at: timestamp, [DEPLOYMENT_KEY]: deploymentEnv() })]
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
