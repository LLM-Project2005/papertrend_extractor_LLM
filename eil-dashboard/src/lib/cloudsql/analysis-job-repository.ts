import { withCloudSqlOwnerTransaction, withCloudSqlServiceTransaction } from "@/lib/cloudsql/client";

type Row = Record<string, unknown>;

export class CloudSqlAnalysisJobRepository {
  async status(ownerUserId: string, options: { folderId?: string | null; jobId?: string | null }) {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const values: unknown[] = [ownerUserId];
      let filter = "";
      if (options.jobId) {
        values.push(options.jobId);
        filter = ` AND id = $${values.length}`;
      } else if (options.folderId && options.folderId !== "all") {
        values.push(options.folderId);
        filter = ` AND folder_id = $${values.length}`;
      }
      const jobs = await client.query<Row>(
        `SELECT * FROM public.folder_analysis_jobs WHERE owner_user_id = $1${filter}
         ORDER BY created_at DESC LIMIT 5`, values
      );
      const runFilter = filter.replace(/\bid\b/, options.jobId ? "folder_analysis_job_id" : "folder_id");
      const runs = await client.query<Row>(
        `SELECT id,owner_user_id,folder_id,folder_analysis_job_id,source_type,status,
          source_filename,display_name,source_extension,mime_type,file_size_bytes,provider,
          model,input_payload,error_message,created_at,updated_at,completed_at
         FROM public.ingestion_runs WHERE owner_user_id = $1${runFilter}
         ORDER BY created_at DESC LIMIT 25`, values
      );
      return { jobs: jobs.rows, runs: runs.rows };
    });
  }

  async listActive(ownerUserId: string, folderJobId?: string | null, limit = 25) {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const values: unknown[] = [ownerUserId];
      let filter = "";
      if (folderJobId) {
        values.push(folderJobId);
        filter = ` AND folder_analysis_job_id = $${values.length}`;
      }
      values.push(limit);
      const result = await client.query<Row>(
        `SELECT id,status,updated_at,input_payload,folder_analysis_job_id
         FROM public.ingestion_runs WHERE owner_user_id = $1 AND source_type = 'upload'
         AND status IN ('queued','processing')${filter} ORDER BY created_at ASC LIMIT $${values.length}`,
        values
      );
      return result.rows;
    });
  }

  async requeueRuns(ownerUserId: string, runIds: string[], reason: string) {
    if (runIds.length === 0) return 0;
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query(
        `UPDATE public.ingestion_runs SET status = 'queued', completed_at = NULL,
         error_message = NULL, updated_at = now(), input_payload = COALESCE(input_payload, '{}'::jsonb) || $3::jsonb
         WHERE owner_user_id = $1 AND id = ANY($2::uuid[]) AND status = 'processing'`,
        [ownerUserId, runIds, JSON.stringify({
          progress_stage: "queued", progress_message: "Recovered stalled analysis run",
          progress_detail: reason, progress_updated_at: new Date().toISOString(),
        })]
      );
      return result.rowCount ?? 0;
    });
  }

  async cancelRuns(ownerUserId: string, runIds: string[]) {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const timestamp = new Date().toISOString();
      const result = await client.query<Row>(
        `UPDATE public.ingestion_runs SET status = 'failed', error_message = 'Canceled by user.',
         completed_at = $3, updated_at = $3,
         input_payload = COALESCE(input_payload, '{}'::jsonb) || $4::jsonb
         WHERE owner_user_id = $1 AND id = ANY($2::uuid[]) AND status IN ('queued','processing') RETURNING *`,
        [ownerUserId, runIds, timestamp, JSON.stringify({
          progress_stage: "failed", progress_message: "Analysis canceled",
          progress_detail: "This run was canceled manually before analysis finished.",
          progress_updated_at: timestamp, canceled_by_user: true,
        })]
      );
      return result.rows;
    });
  }

  async recoverAll(options: { staleBefore: string; orphanBefore: string; maxRows: number }) {
    return withCloudSqlServiceTransaction(async (client) => {
      const stale = await client.query<Row>(
        `SELECT id,input_payload FROM public.ingestion_runs WHERE source_type = 'upload'
         AND status = 'processing' AND updated_at < $1 ORDER BY updated_at ASC LIMIT $2`,
        [options.staleBefore, options.maxRows]
      );
      const staleIds = stale.rows.map((row) => String(row.id));
      let requeuedRuns = 0;
      if (staleIds.length) {
        const updated = await client.query(
          `UPDATE public.ingestion_runs SET status='queued',completed_at=NULL,error_message=NULL,
           updated_at=now(),input_payload=COALESCE(input_payload,'{}'::jsonb) || $2::jsonb
           WHERE id=ANY($1::uuid[]) AND status='processing'`,
          [staleIds, JSON.stringify({ progress_stage: "queued", progress_message: "Recovered stalled analysis run", progress_updated_at: new Date().toISOString() })]
        );
        requeuedRuns = updated.rowCount ?? 0;
      }
      const orphan = await client.query<{ id: string }>(
        `SELECT j.id FROM public.folder_analysis_jobs j LEFT JOIN public.ingestion_runs r
         ON r.folder_analysis_job_id=j.id WHERE j.status IN ('queued','processing')
         AND j.updated_at < $1 GROUP BY j.id HAVING count(r.id)=0 ORDER BY min(j.updated_at) ASC LIMIT $2`,
        [options.orphanBefore, options.maxRows]
      );
      const orphanIds = orphan.rows.map((row) => row.id);
      let failedOrphanJobs = 0;
      if (orphanIds.length) {
        const updated = await client.query(
          `UPDATE public.folder_analysis_jobs SET status='failed',queued_runs=0,processing_runs=0,
           succeeded_runs=0,failed_runs=0,progress_stage='failed',progress_message='Failed',
           progress_detail='No ingestion runs were found for this queued job.',completed_at=now(),updated_at=now()
           WHERE id=ANY($1::uuid[]) AND status IN ('queued','processing')`, [orphanIds]
        );
        failedOrphanJobs = updated.rowCount ?? 0;
      }
      return { scannedStaleRuns: staleIds.length, requeuedRuns, scannedCandidateJobs: orphanIds.length, failedOrphanJobs };
    });
  }
}

export const cloudSqlAnalysisJobRepository = new CloudSqlAnalysisJobRepository();
