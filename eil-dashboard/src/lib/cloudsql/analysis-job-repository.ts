import { withCloudSqlOwnerTransaction, withCloudSqlServiceTransaction } from "@/lib/cloudsql/client";
import { DEPLOYMENT_KEY, deploymentEnv } from "@/lib/deployment";
import { usableAnalysisSql } from "@/lib/usable-analysis";

const KEPT = usableAnalysisSql("ir");

/** Exported so the SQL can be run against a real Postgres in tests. */
export const CANCEL_RUNS_SQL = `UPDATE public.ingestion_runs ir SET
   status = CASE WHEN ${KEPT} THEN 'succeeded' ELSE 'failed' END,
   error_message = CASE WHEN ${KEPT} THEN NULL ELSE 'Canceled by user.' END,
   completed_at = CASE WHEN ${KEPT}
     THEN COALESCE((ir.input_payload->'analysis_metrics'->>'completed_at')::timestamptz, $3::timestamptz)
     ELSE $3::timestamptz END,
   updated_at = $3,
   input_payload = COALESCE(ir.input_payload, '{}'::jsonb) || CASE WHEN ${KEPT} THEN $5::jsonb ELSE $4::jsonb END
 WHERE ir.owner_user_id = $1 AND ir.id = ANY($2::uuid[]) AND ir.status IN ('queued','processing') RETURNING *`;

/**
 * The payload fields the progress tray reads, and nothing else: it polls up to
 * 200 runs every few seconds, and a whole payload is several kilobytes. The
 * paper id goes as text, since a 60-bit number would be rounded by JSON.parse.
 */
export const TRAY_RUN_SQL = `SELECT id, owner_user_id, folder_id, folder_analysis_job_id, source_type, status,
    source_filename, display_name, source_extension, mime_type, file_size_bytes, provider, model,
    error_message, created_at, updated_at, completed_at, trashed_at,
    jsonb_strip_nulls(jsonb_build_object(
      'paper_title', input_payload->'paper_title',
      'paper_id', input_payload->>'paper_id',
      'analysis_label', input_payload->'analysis_label',
      'source_kind', input_payload->'source_kind',
      'project_id', input_payload->'project_id',
      'keyword_count', input_payload->'keyword_count',
      'duplicate_of', input_payload->'duplicate_of',
      'progress_stage', input_payload->'progress_stage',
      'progress_message', input_payload->'progress_message',
      'progress_detail', input_payload->'progress_detail',
      'progress_updated_at', input_payload->'progress_updated_at',
      'lifecycle_state', input_payload->'lifecycle_state',
      'lifecycle_rank', input_payload->'lifecycle_rank',
      'lifecycle_is_terminal', input_payload->'lifecycle_is_terminal',
      'lifecycle_updated_at', input_payload->'lifecycle_updated_at',
      'canceled_by_user', input_payload->'canceled_by_user',
      'reanalysis_requested_at', input_payload->'reanalysis_requested_at',
      'reanalysis_failed_at', input_payload->'reanalysis_failed_at',
      'reanalysis_canceled_at', input_payload->'reanalysis_canceled_at',
      'reanalysis_error', input_payload->'reanalysis_error',
      'analysis_metrics', jsonb_strip_nulls(jsonb_build_object(
        'completed_at', input_payload->'analysis_metrics'->'completed_at',
        'completed_graph_nodes', input_payload->'analysis_metrics'->'completed_graph_nodes',
        'graph_seconds', input_payload->'analysis_metrics'->'graph_seconds',
        'queue_wait_seconds', input_payload->'analysis_metrics'->'queue_wait_seconds',
        'total_worker_seconds', input_payload->'analysis_metrics'->'total_worker_seconds'))
    )) AS input_payload
  FROM public.ingestion_runs
  WHERE owner_user_id = $1 AND id = ANY($2::uuid[])
  ORDER BY created_at ASC`;

/** How often one paper may be analysed again in a day. */
export const MAX_REANALYSES_PER_PAPER_PER_DAY = 3;

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

  /**
   * The runs a person is following, by id, however many (docs/32, 2.6). The
   * tray used to read the 25 newest runs of the batch or the account, so a
   * batch of 50, or a re-analysis of older papers, showed wrong totals.
   */
  async trayStatus(ownerUserId: string, runIds: string[], folderJobId?: string | null) {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const runs = await client.query<Row>(TRAY_RUN_SQL, [ownerUserId, runIds]);
      const job = folderJobId
        ? await client.query<Row>(
            `SELECT * FROM public.folder_analysis_jobs WHERE owner_user_id = $1 AND id = $2 LIMIT 1`,
            [ownerUserId, folderJobId]
          )
        : null;
      return { runs: runs.rows, job: job?.rows[0] ?? null };
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
   *
   * `context` carries what an upload is given today and older runs lack: the
   * repository's current profile and its id. Without a profile the
   * classifier has no categories (re-analysing testtest left 37 of 39 papers
   * "Other" in an EIL repository); without the id, category rows are saved
   * with no repository and neither the dashboard nor coverage counts them.
   */
  async queueReanalysis(
    ownerUserId: string,
    selection: { runIds?: string[]; projectId?: string },
    limit = 200,
    context: { analysisProfile?: unknown; projectId?: string | null } = {}
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
      // Each analysis spends model credit, so a paper is analysed again at most
      // MAX_REANALYSES_PER_PAPER_PER_DAY times a (UTC) day. The count lives in
      // the run's own payload, so no table change is needed.
      const today = timestamp.slice(0, 10);
      const profileJson = context.analysisProfile ? JSON.stringify(context.analysisProfile) : null;
      const payloadProjectId = context.projectId || null;
      const result = await client.query<{ id: string }>(
        `UPDATE public.ingestion_runs ir SET status = 'queued', completed_at = NULL, error_message = NULL,
           updated_at = now(),
           input_payload = COALESCE(ir.input_payload, '{}'::jsonb)
             || jsonb_build_object(
                  'reanalysis_count', COALESCE((ir.input_payload->>'reanalysis_count')::int, 0) + 1,
                  'reanalysis_requested_at', $${values.length + 1}::text,
                  'reanalysis_day', $${values.length + 4}::text,
                  'reanalysis_day_count', CASE WHEN ir.input_payload->>'reanalysis_day' = $${values.length + 4}::text
                    THEN COALESCE((ir.input_payload->>'reanalysis_day_count')::int, 0) + 1 ELSE 1 END,
                  'progress_stage', 'queued',
                  'progress_message', 'Queued to be analysed again',
                  'progress_detail', 'This paper will be analysed again with the current pipeline.',
                  'progress_updated_at', $${values.length + 1}::text)
             || CASE WHEN $${values.length + 2}::jsonb IS NULL THEN '{}'::jsonb
                     ELSE jsonb_build_object('analysis_profile', $${values.length + 2}::jsonb) END
             || CASE WHEN $${values.length + 3}::text IS NULL THEN '{}'::jsonb
                     ELSE jsonb_build_object('project_id', $${values.length + 3}::text) END
             || jsonb_build_object('deployment', $${values.length + 6}::text)
         WHERE ir.id IN (
           SELECT ir.id FROM public.ingestion_runs ir
           WHERE ir.owner_user_id = $1 AND ir.trashed_at IS NULL
             AND COALESCE(ir.source_path, '') <> '' AND ${scope}
             AND NOT (COALESCE(ir.input_payload->>'reanalysis_day', '') = $${values.length + 4}::text
                      AND COALESCE((ir.input_payload->>'reanalysis_day_count')::int, 0) >= $${values.length + 5}::int)
           ORDER BY ir.created_at ASC LIMIT $${values.length})
         RETURNING ir.id`,
        [...values, timestamp, profileJson, payloadProjectId, today, MAX_REANALYSES_PER_PAPER_PER_DAY, deploymentEnv()]
      );
      return result.rows.map((row) => String(row.id));
    });
  }

  /** The repository each of the owner's runs belongs to, through its folder. */
  async projectsOfRuns(ownerUserId: string, runIds: string[]): Promise<Map<string, string[]>> {
    const byProject = new Map<string, string[]>();
    if (runIds.length === 0) return byProject;
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query<{ id: string; project_id: string | null }>(
        `SELECT ir.id, rf.project_id
         FROM public.ingestion_runs ir
         LEFT JOIN public.research_folders rf ON rf.id = ir.folder_id AND rf.owner_user_id = ir.owner_user_id
         WHERE ir.owner_user_id = $1 AND ir.id = ANY($2::uuid[])`,
        [ownerUserId, runIds]
      );
      for (const row of result.rows) {
        const key = row.project_id ? String(row.project_id) : "";
        byProject.set(key, [...(byProject.get(key) ?? []), String(row.id)]);
      }
      return byProject;
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
      // A copy made before copies had their own analysis has no paper under
      // this id; saving the correction to the run alone used to report success
      // while nothing the reader sees changed.
      const exists = await client.query(`SELECT 1 FROM public.papers WHERE id = $1 AND owner_user_id = $2`, [paperId, ownerUserId]);
      if (!exists.rows[0]) return null;
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
      return paper.rows[0] ?? null;
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
          [DEPLOYMENT_KEY]: deploymentEnv(),
        })]
      );
      return result.rowCount ?? 0;
    });
  }

  /**
   * Cancels runs. A re-analysis goes back to "succeeded" with its earlier
   * results (docs/32, 2.4) - they were never removed - instead of being
   * marked failed, which also kept it out of any later re-analysis.
   */
  async cancelRuns(ownerUserId: string, runIds: string[]) {
    return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const timestamp = new Date().toISOString();
      const result = await client.query<Row>(
        CANCEL_RUNS_SQL,
        [ownerUserId, runIds, timestamp, JSON.stringify({
          progress_stage: "failed", progress_message: "Analysis canceled",
          progress_detail: "This run was canceled manually before analysis finished.",
          progress_updated_at: timestamp, canceled_by_user: true,
        }), JSON.stringify({
          progress_stage: "completed", progress_message: "Analysis complete",
          progress_detail: "Analyzing this paper again was canceled, so its earlier results are kept.",
          progress_updated_at: timestamp, reanalysis_canceled_at: timestamp,
        })]
      );
      return result.rows;
    });
  }

  async recoverAll(options: { staleBefore: string; orphanBefore: string; maxRows: number }) {
    return withCloudSqlServiceTransaction(async (client) => {
      const stale = await client.query<Row>(
        `SELECT id,input_payload FROM public.ingestion_runs WHERE source_type = 'upload'
         AND status = 'processing' AND updated_at < $1
         AND COALESCE(input_payload->>'deployment', 'production') = $3
         ORDER BY updated_at ASC LIMIT $2`,
        [options.staleBefore, options.maxRows, deploymentEnv()]
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
