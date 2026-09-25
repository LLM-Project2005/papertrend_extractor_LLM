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

  /**
   * Queue finished papers to be analysed again under the same run id, so the
   * paper id (derived from the run id) and everything that points at it stay
   * the same. Only the owner's own succeeded, untrashed runs with a stored
   * file qualify. A user's title/year corrections live in input_payload and
   * are kept.
   */
  async queueReanalysis(
    ownerUserId: string,
    selection: { runIds?: string[]; projectId?: string },
    limit = 200
  ): Promise<string[]> {
    const runIds = (selection.runIds ?? []).filter(Boolean);
    if (!runIds.length && !selection.projectId) return [];
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const values: unknown[] = [ownerUserId];
      let scope: string;
      // A paper picked on its own may also be one that failed, so "Try again"
      // works; a whole repository is re-analysed from its finished papers only.
      if (runIds.length) {
        values.push(runIds);
        scope = `ir.id = ANY($${values.length}::uuid[]) AND ir.status IN ('succeeded', 'failed')`;
      } else {
        values.push(selection.projectId);
        scope = `ir.status = 'succeeded' AND ir.folder_id IN (SELECT rf.id FROM public.research_folders rf
                 WHERE rf.owner_user_id = $1 AND rf.project_id = $${values.length})`;
      }
      values.push(limit);
      const timestamp = new Date().toISOString();
      const result = await client.query<{ id: string }>(
        `UPDATE public.ingestion_runs ir SET status = 'queued', completed_at = NULL, error_message = NULL,
           updated_at = now(),
           input_payload = COALESCE(ir.input_payload, '{}'::jsonb)
             || jsonb_build_object(
                  'reanalysis_count', COALESCE((ir.input_payload->>'reanalysis_count')::int, 0) + 1,
                  'reanalysis_requested_at', $${values.length + 1}::text,
                  'progress_stage', 'queued',
                  'progress_message', 'Queued to be analysed again',
                  'progress_detail', 'This paper will be analysed again with the current pipeline.',
                  'progress_updated_at', $${values.length + 1}::text)
         WHERE ir.id IN (
           SELECT ir.id FROM public.ingestion_runs ir
           WHERE ir.owner_user_id = $1 AND ir.trashed_at IS NULL
             AND COALESCE(ir.source_path, '') <> '' AND ${scope}
           ORDER BY ir.created_at ASC LIMIT $${values.length})
         RETURNING ir.id`,
        [...values, timestamp]
      );
      return result.rows.map((row) => String(row.id));
    });
  }

  /**
   * Record a user's title/year correction on the run (so re-analysis keeps
   * it) and apply it to the stored paper at once.
   */
  async correctPaper(
    ownerUserId: string,
    runId: string,
    correction: { title?: string; year?: string },
    paperId: string
  ): Promise<{ title: string; year: string } | null> {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const run = await client.query<{ input_payload: Row | null }>(
        `SELECT input_payload FROM public.ingestion_runs WHERE id = $1 AND owner_user_id = $2 FOR UPDATE`,
        [runId, ownerUserId]
      );
      if (!run.rows[0]) return null;
      const payload = (run.rows[0].input_payload ?? {}) as Row;
      const previous = (payload.user_overrides && typeof payload.user_overrides === "object"
        ? payload.user_overrides
        : {}) as Row;
      const overrides: Row = { ...previous, corrected_at: new Date().toISOString() };
      if (correction.title !== undefined) overrides.title = correction.title;
      if (correction.year !== undefined) overrides.year = correction.year;
      await client.query(
        `UPDATE public.ingestion_runs SET updated_at = now(),
           input_payload = COALESCE(input_payload, '{}'::jsonb) || jsonb_build_object('user_overrides', $3::jsonb)
         WHERE id = $1 AND owner_user_id = $2`,
        [runId, ownerUserId, JSON.stringify(overrides)]
      );
      const paper = await client.query<{ title: string; year: string }>(
        `UPDATE public.papers SET
           title = COALESCE($3, title),
           year = COALESCE($4, year),
           year_source = CASE WHEN $4::text IS NULL THEN year_source ELSE 'user' END,
           year_confidence = CASE WHEN $4::text IS NULL THEN year_confidence ELSE 1 END,
           year_evidence = CASE WHEN $4::text IS NULL THEN year_evidence ELSE 'Corrected by a user in the paper library.' END
         WHERE id = $1 AND owner_user_id = $2
         RETURNING title, year`,
        [paperId, ownerUserId, correction.title ?? null, correction.year ?? null]
      );
      return paper.rows[0] ?? { title: String(correction.title ?? ""), year: String(correction.year ?? "") };
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
