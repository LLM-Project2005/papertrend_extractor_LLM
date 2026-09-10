import { randomUUID } from "crypto";
import type { ProjectReclassificationJobRow } from "@/types/database";
import type { ProjectAnalysisProfile } from "@/types/workspace";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { markProjectSemanticMapsStale } from "@/lib/semantic-map-invalidation";

export interface ReclassificationPaper {
  itemId: string;
  paperId: string;
  runId: string | null;
  folderId: string | null;
  title: string;
  year: string;
  abstractClaims: string;
  methods: string;
  results: string;
  conclusion: string;
  concepts: string[];
}

export async function getClassificationCoverage(ownerUserId: string, projectId: string) {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const project = await client.query<{ analysis_profile_hash: string | null; classification_enabled: boolean }>(
      `SELECT analysis_profile_hash,
              COALESCE((analysis_profile->>'classificationEnabled')::boolean, true) AS classification_enabled
       FROM public.workspace_projects WHERE id=$1 AND owner_user_id=$2`,
      [projectId, ownerUserId]
    );
    if (!project.rows[0]) throw new Error("Repository not found.");
    const result = await client.query<{ current_count: string; previous_count: string; unclassified_count: string; failed_count: string }>(
      `WITH eligible AS (
         SELECT DISTINCT p.id
         FROM public.papers p
         JOIN public.research_folders f ON f.id=p.folder_id AND f.project_id=$2
         JOIN public.paper_content c ON c.paper_id=p.id AND c.owner_user_id=$1
         JOIN public.ingestion_runs r ON r.id=c.ingestion_run_id AND r.owner_user_id=$1
         WHERE p.owner_user_id=$1 AND r.status='succeeded' AND r.trashed_at IS NULL
       ), classified AS (
         SELECT paper_id, bool_or(profile_hash=$3) AS has_current_profile
         FROM public.paper_category_assignments
         WHERE owner_user_id=$1 AND project_id=$2 AND assignment_type='single'
         GROUP BY paper_id
       )
       SELECT
         count(*) FILTER (WHERE ($4::boolean AND c.paper_id IS NULL)
                            OR (NOT $4::boolean AND c.has_current_profile))::text AS current_count,
         count(*) FILTER (WHERE ($4::boolean AND c.paper_id IS NOT NULL)
                            OR (NOT $4::boolean AND c.paper_id IS NOT NULL AND NOT c.has_current_profile))::text AS previous_count,
         count(*) FILTER (WHERE NOT $4::boolean AND c.paper_id IS NULL)::text AS unclassified_count,
         (SELECT count(*)::text
          FROM public.ingestion_runs failed_run
          JOIN public.research_folders failed_folder
            ON failed_folder.id=failed_run.folder_id
           AND failed_folder.owner_user_id=$1
           AND failed_folder.project_id=$2
          WHERE failed_run.owner_user_id=$1
            AND failed_run.status='failed'
            AND failed_run.trashed_at IS NULL) AS failed_count
       FROM eligible e LEFT JOIN classified c ON c.paper_id=e.id`,
      [ownerUserId, projectId, project.rows[0].analysis_profile_hash, !project.rows[0].classification_enabled]
    );
    const row = result.rows[0];
    return {
      classified: Number(row?.current_count ?? 0),
      previousProfile: Number(row?.previous_count ?? 0),
      unclassified: Number(row?.unclassified_count ?? 0),
      failed: Number(row?.failed_count ?? 0),
    };
  });
}

export async function createReclassificationJob(
  ownerUserId: string,
  projectId: string,
  profile: ProjectAnalysisProfile
): Promise<ProjectReclassificationJobRow> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const project = await client.query<{ id: string }>(
      `SELECT id FROM public.workspace_projects WHERE id=$1 AND owner_user_id=$2 FOR UPDATE`,
      [projectId, ownerUserId]
    );
    if (!project.rows[0]) throw new Error("Repository not found.");
    const active = await client.query<ProjectReclassificationJobRow>(
      `SELECT * FROM public.project_reclassification_jobs
       WHERE owner_user_id=$1 AND project_id=$2 AND status IN ('queued','processing')
       ORDER BY created_at DESC LIMIT 1`,
      [ownerUserId, projectId]
    );
    if (active.rows[0]) return active.rows[0];

    const id = randomUUID();
    const papers = await client.query<{ paper_id: string; ingestion_run_id: string | null; folder_id: string | null }>(
      `SELECT DISTINCT p.id::text AS paper_id,c.ingestion_run_id::text,p.folder_id::text
       FROM public.papers p
       JOIN public.research_folders f ON f.id=p.folder_id AND f.project_id=$2
       JOIN public.paper_content c ON c.paper_id=p.id AND c.owner_user_id=$1
       JOIN public.ingestion_runs r ON r.id=c.ingestion_run_id AND r.owner_user_id=$1
       WHERE p.owner_user_id=$1 AND r.status='succeeded' AND r.trashed_at IS NULL
       ORDER BY p.id`,
      [ownerUserId, projectId]
    );
    const created = await client.query<ProjectReclassificationJobRow>(
      `INSERT INTO public.project_reclassification_jobs
       (id,owner_user_id,project_id,target_profile,target_profile_hash,target_profile_version,total_items)
       VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7) RETURNING *`,
      [id, ownerUserId, projectId, JSON.stringify(profile), profile.profileHash, profile.version, papers.rowCount]
    );
    for (const paper of papers.rows) {
      await client.query(
        `INSERT INTO public.project_reclassification_items
         (job_id,owner_user_id,project_id,paper_id,ingestion_run_id,folder_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, ownerUserId, projectId, paper.paper_id, paper.ingestion_run_id, paper.folder_id]
      );
    }
    return created.rows[0];
  });
}

export async function getReclassificationJob(ownerUserId: string, projectId: string, jobId: string) {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query<ProjectReclassificationJobRow>(
      `SELECT * FROM public.project_reclassification_jobs WHERE id=$1 AND project_id=$2 AND owner_user_id=$3`,
      [jobId, projectId, ownerUserId]
    );
    return result.rows[0] ?? null;
  });
}

export async function claimReclassificationJob(ownerUserId: string, jobId: string) {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query<ProjectReclassificationJobRow>(
      `UPDATE public.project_reclassification_jobs
       SET status='processing',progress_stage='classifying',updated_at=now()
       WHERE id=$1 AND owner_user_id=$2 AND status='queued' RETURNING *`,
      [jobId, ownerUserId]
    );
    return result.rows[0] ?? null;
  });
}

export async function loadReclassificationPapers(ownerUserId: string, jobId: string): Promise<ReclassificationPaper[]> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query<Record<string, unknown>>(
      `WITH claimed AS (
         UPDATE public.project_reclassification_items
         SET status='processing',updated_at=now()
         WHERE job_id=$1 AND owner_user_id=$2 AND status IN ('queued','failed')
         RETURNING *
       )
       SELECT i.id::text AS item_id,i.paper_id::text,i.ingestion_run_id::text,i.folder_id::text,
              p.title,p.year,c.abstract_claims,c.methods,c.results,c.conclusion,
              COALESCE(jsonb_agg(DISTINCT k.concept_label) FILTER (WHERE k.concept_label IS NOT NULL),'[]'::jsonb) AS concepts
       FROM claimed i
       JOIN public.papers p ON p.id=i.paper_id AND p.owner_user_id=$2
       JOIN public.paper_content c ON c.paper_id=i.paper_id AND c.owner_user_id=$2
       LEFT JOIN public.paper_keyword_concepts k ON k.paper_id=i.paper_id AND k.owner_user_id=$2
       GROUP BY i.id,i.paper_id,i.ingestion_run_id,i.folder_id,p.title,p.year,c.abstract_claims,c.methods,c.results,c.conclusion
       ORDER BY i.paper_id`,
      [jobId, ownerUserId]
    );
    return result.rows.map((row) => ({
      itemId: String(row.item_id), paperId: String(row.paper_id),
      runId: row.ingestion_run_id ? String(row.ingestion_run_id) : null,
      folderId: row.folder_id ? String(row.folder_id) : null,
      title: String(row.title ?? "Untitled paper"), year: String(row.year ?? "Unknown"),
      abstractClaims: String(row.abstract_claims ?? ""), methods: String(row.methods ?? ""),
      results: String(row.results ?? ""), conclusion: String(row.conclusion ?? ""),
      concepts: Array.isArray(row.concepts) ? row.concepts.map(String) : [],
    }));
  });
}

export async function saveReclassificationItem(
  ownerUserId: string,
  jobId: string,
  itemId: string,
  result: Record<string, unknown> | null,
  model: string | null,
  error: unknown = null
) {
  const message = error ? (error instanceof Error ? error.message : String(error)).slice(0, 1000) : null;
  await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    await client.query(
      `UPDATE public.project_reclassification_items
       SET status=$4,result_payload=$5::jsonb,classifier_model=$6,error_message=$7,completed_at=now(),updated_at=now()
       WHERE id=$1 AND job_id=$2 AND owner_user_id=$3 AND status='processing'`,
      [itemId, jobId, ownerUserId, error ? "failed" : "succeeded", result ? JSON.stringify(result) : null, model, message]
    );
    await client.query(
      `UPDATE public.project_reclassification_jobs j SET
         processed_items=(SELECT count(*) FROM public.project_reclassification_items WHERE job_id=j.id AND status='succeeded'),
         failed_items=(SELECT count(*) FROM public.project_reclassification_items WHERE job_id=j.id AND status='failed'),
         updated_at=now() WHERE id=$1 AND owner_user_id=$2`,
      [jobId, ownerUserId]
    );
  });
}

export async function cancelReclassificationJob(ownerUserId: string, projectId: string, jobId: string) {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query<ProjectReclassificationJobRow>(
      `UPDATE public.project_reclassification_jobs SET status='canceled',progress_stage='canceled',completed_at=now(),updated_at=now()
       WHERE id=$1 AND project_id=$2 AND owner_user_id=$3 AND status IN ('queued','processing') RETURNING *`,
      [jobId, projectId, ownerUserId]
    );
    await client.query(
      `UPDATE public.project_reclassification_items SET status='canceled',completed_at=now(),updated_at=now()
       WHERE job_id=$1 AND owner_user_id=$2 AND status IN ('queued','processing')`,
      [jobId, ownerUserId]
    );
    return result.rows[0] ?? null;
  });
}

export async function retryReclassificationJob(ownerUserId: string, projectId: string, jobId: string) {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query<ProjectReclassificationJobRow>(
      `UPDATE public.project_reclassification_jobs SET status='queued',progress_stage='queued',
       failed_items=0,error_message=NULL,completed_at=NULL,updated_at=now()
       WHERE id=$1 AND project_id=$2 AND owner_user_id=$3 AND status='failed' RETURNING *`,
      [jobId, projectId, ownerUserId]
    );
    if (!result.rows[0]) return null;
    await client.query(
      `UPDATE public.project_reclassification_items SET status='queued',result_payload=NULL,classifier_model=NULL,
       error_message=NULL,completed_at=NULL,updated_at=now()
       WHERE job_id=$1 AND owner_user_id=$2 AND status='failed'`,
      [jobId, ownerUserId]
    );
    return result.rows[0];
  });
}

function legacyColumns(keys: string[], profile: ProjectAnalysisProfile) {
  if (profile.mode === "general") return { el: 0, eli: 0, lae: 0, other: 1 };
  const compatibilityKeys = profile.mode === "eil"
    ? { el: "el", eli: "eli", lae: "lae" }
    : {
        el: profile.categories[0]?.key,
        eli: profile.categories[1]?.key,
        lae: profile.categories[2]?.key,
      };
  return {
    el: compatibilityKeys.el && keys.includes(compatibilityKeys.el) ? 1 : 0,
    eli: compatibilityKeys.eli && keys.includes(compatibilityKeys.eli) ? 1 : 0,
    lae: compatibilityKeys.lae && keys.includes(compatibilityKeys.lae) ? 1 : 0,
    other: keys.includes("other") ? 1 : 0,
  };
}

export async function publishReclassificationJob(ownerUserId: string, jobId: string) {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const jobResult = await client.query<ProjectReclassificationJobRow>(
      `SELECT * FROM public.project_reclassification_jobs WHERE id=$1 AND owner_user_id=$2 FOR UPDATE`,
      [jobId, ownerUserId]
    );
    const job = jobResult.rows[0];
    if (!job || job.status !== "processing") throw new Error("Reclassification job is no longer publishable.");
    const failed = await client.query<{ count: string }>(
      `SELECT count(*)::text FROM public.project_reclassification_items WHERE job_id=$1 AND owner_user_id=$2 AND status<>'succeeded'`,
      [jobId, ownerUserId]
    );
    if (Number(failed.rows[0]?.count ?? 0) > 0) throw new Error("Some papers were not classified; the previous revision was preserved.");
    const profile = job.target_profile as ProjectAnalysisProfile;
    const items = await client.query<Record<string, unknown>>(
      `SELECT * FROM public.project_reclassification_items WHERE job_id=$1 AND owner_user_id=$2 ORDER BY paper_id`,
      [jobId, ownerUserId]
    );
    await client.query(`DELETE FROM public.paper_category_assignments WHERE owner_user_id=$1 AND project_id=$2`, [ownerUserId, job.project_id]);
    await client.query(`DELETE FROM public.paper_category_definitions WHERE owner_user_id=$1 AND project_id=$2`, [ownerUserId, job.project_id]);
    for (const item of items.rows) {
      const result = (item.result_payload ?? {}) as Record<string, unknown>;
      const primary = String(result.primaryCategoryKey ?? "other");
      const additional = Array.isArray(result.additionalCategoryKeys) ? result.additionalCategoryKeys.map(String) : [];
      const keys = [...new Set([primary, ...additional])];
      const model = String(item.classifier_model ?? "unknown");
      if (profile.classificationEnabled) {
        for (const [position, category] of profile.categories.entries()) {
          await client.query(
            `INSERT INTO public.paper_category_definitions
             (paper_id,owner_user_id,folder_id,project_id,taxonomy_name,taxonomy_definition,domain,domain_definition,
              category_key,category_label,category_description,position,profile_hash,profile_version,classification_revision_id,classifier_model,classified_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now())`,
            [item.paper_id, ownerUserId, item.folder_id, job.project_id, profile.taxonomyName, profile.taxonomyDefinition,
             profile.domain, profile.domainDefinition, category.key, category.label, category.description, position + 1,
             profile.profileHash, profile.version, jobId, model]
          );
        }
        const definitions = new Map(profile.categories.map((category) => [category.key, category]));
        const resolvedKeys = keys.filter((key) => definitions.has(key));
        const effectiveKeys = resolvedKeys.length ? resolvedKeys : ["other"];
        for (const [position, key] of effectiveKeys.entries()) {
          const category = definitions.get(key);
          const assignmentTypes = ["single", "multi"] as const;
          for (const assignmentType of assignmentTypes) {
            if (assignmentType === "single" && position > 0) continue;
            await client.query(
              `INSERT INTO public.paper_category_assignments
               (paper_id,owner_user_id,folder_id,project_id,taxonomy_name,category_key,category_label,assignment_type,is_other,
                rationale,position,profile_hash,profile_version,classification_revision_id,classifier_model,classified_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())`,
              [item.paper_id, ownerUserId, item.folder_id, job.project_id, profile.taxonomyName, key,
               category?.label ?? "Other / Unclassified", assignmentType, key === "other", String(result.rationale ?? ""),
               position + 1, profile.profileHash, profile.version, jobId, model]
            );
          }
        }
      }
      const single = legacyColumns([primary], profile);
      const multi = legacyColumns(keys, profile);
      await client.query(
        `INSERT INTO public.paper_tracks_single(paper_id,owner_user_id,folder_id,el,eli,lae,other)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(paper_id) DO UPDATE SET
         owner_user_id=EXCLUDED.owner_user_id,folder_id=EXCLUDED.folder_id,el=EXCLUDED.el,eli=EXCLUDED.eli,lae=EXCLUDED.lae,other=EXCLUDED.other,created_at=now()`,
        [item.paper_id, ownerUserId, item.folder_id, single.el, single.eli, single.lae, single.other]
      );
      await client.query(
        `INSERT INTO public.paper_tracks_multi(paper_id,owner_user_id,folder_id,el,eli,lae,other)
         VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(paper_id) DO UPDATE SET
         owner_user_id=EXCLUDED.owner_user_id,folder_id=EXCLUDED.folder_id,el=EXCLUDED.el,eli=EXCLUDED.eli,lae=EXCLUDED.lae,other=EXCLUDED.other,created_at=now()`,
        [item.paper_id, ownerUserId, item.folder_id, multi.el, multi.eli, multi.lae, multi.other]
      );
    }
    await client.query(`DELETE FROM public.workspace_analytics_cache WHERE owner_user_id=$1 AND scope_type='project' AND scope_key=$2`, [ownerUserId, job.project_id]);
    await markProjectSemanticMapsStale(client, ownerUserId, job.project_id);
    await client.query(
      `UPDATE public.project_reclassification_jobs SET status='succeeded',progress_stage='published',processed_items=total_items,
       failed_items=0,completed_at=now(),updated_at=now() WHERE id=$1 AND owner_user_id=$2`,
      [jobId, ownerUserId]
    );
    return { projectId: job.project_id, published: items.rowCount };
  });
}

export async function failReclassificationJob(ownerUserId: string, jobId: string, error: unknown) {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
  await withCloudSqlOwnerTransaction(ownerUserId, (client) => client.query(
    `UPDATE public.project_reclassification_jobs SET status='failed',progress_stage='failed',error_message=$3,completed_at=now(),updated_at=now()
     WHERE id=$1 AND owner_user_id=$2 AND status<>'canceled'`, [jobId, ownerUserId, message]
  ).then(() => undefined));
}
