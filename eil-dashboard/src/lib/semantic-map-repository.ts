import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import type {
  RepositorySemanticMap,
  SemanticMapCluster,
  SemanticMapEdge,
  SemanticMapPoint,
  SemanticMapCoverage,
  SemanticPaperDocument,
} from "@/types/semantic-map";

export const SEMANTIC_REPRESENTATION_VERSION = "paper-semantic-document-v1";

type PaperSourceRow = {
  paper_id: string;
  run_id: string | null;
  project_id: string;
  folder_id: string | null;
  folder_name: string | null;
  title: string;
  year: string | null;
  abstract: string | null;
  abstract_claims: string | null;
  methods: string | null;
  results: string | null;
  conclusion: string | null;
  categories: unknown;
  topics: unknown;
  keywords: unknown;
  objectives: unknown;
  track: string | null;
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function clip(value: string | null | undefined, maximum = 6_000): string {
  const normalized = String(value ?? "").trim();
  return normalized.length <= maximum ? normalized : `${normalized.slice(0, maximum).trimEnd()}...`;
}

function composeDocument(row: PaperSourceRow): SemanticPaperDocument {
  const categories = stringList(row.categories);
  const topics = stringList(row.topics);
  const keywords = stringList(row.keywords);
  const objectives = stringList(row.objectives);
  const sections = [
    `# ${row.title.trim() || "Untitled paper"}`,
    `Publication year: ${row.year?.trim() || "Unknown"}`,
    categories.length ? `Categories: ${categories.join(", ")}` : "",
    topics.length ? `Topics: ${topics.join(", ")}` : "",
    keywords.length ? `Keywords: ${keywords.join(", ")}` : "",
    clip(row.abstract_claims || row.abstract) ? `## Abstract\n${clip(row.abstract_claims || row.abstract)}` : "",
    objectives.length ? `## Research objectives\n${objectives.join("; ")}` : "",
    clip(row.methods) ? `## Methods\n${clip(row.methods)}` : "",
    clip(row.results) ? `## Findings\n${clip(row.results)}` : "",
    clip(row.conclusion) ? `## Conclusion\n${clip(row.conclusion)}` : "",
  ].filter(Boolean);
  const documentText = sections.join("\n\n");
  return {
    paperId: String(row.paper_id),
    runId: row.run_id ? String(row.run_id) : null,
    projectId: String(row.project_id),
    folderId: row.folder_id ? String(row.folder_id) : null,
    folderName: row.folder_name ? String(row.folder_name) : null,
    title: row.title.trim() || "Untitled paper",
    year: row.year?.trim() || "Unknown",
    abstract: clip(row.abstract_claims || row.abstract),
    objectives,
    methods: clip(row.methods),
    results: clip(row.results),
    conclusion: clip(row.conclusion),
    categories,
    topics,
    keywords,
    track: row.track?.trim() || null,
    documentText,
    contentHash: sha256(`${SEMANTIC_REPRESENTATION_VERSION}\n${documentText}`),
  };
}

async function assertProject(client: PoolClient, ownerUserId: string, projectId: string): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM public.workspace_projects WHERE id=$1 AND owner_user_id=$2 LIMIT 1`,
    [projectId, ownerUserId]
  );
  if (!result.rows[0]) throw new Error("Repository not found.");
}

async function loadDocumentsWithClient(
  client: PoolClient,
  ownerUserId: string,
  projectId: string
): Promise<SemanticPaperDocument[]> {
  await assertProject(client, ownerUserId, projectId);
  const result = await client.query<PaperSourceRow>(
    `SELECT
       p.id::text AS paper_id,
       pc.ingestion_run_id::text AS run_id,
       COALESCE(rf.project_id, CASE WHEN ir.input_payload->>'project_id' ~* '^[0-9a-f-]{36}$' THEN (ir.input_payload->>'project_id')::uuid END)::text AS project_id,
       rf.id::text AS folder_id,
       rf.name AS folder_name,
       p.title,
       p.year,
       pc.abstract,
       pc.abstract_claims,
       pc.methods,
       pc.results,
       pc.conclusion,
       COALESCE((SELECT jsonb_agg(DISTINCT pca.category_label ORDER BY pca.category_label)
                 FROM public.paper_category_assignments pca
                 WHERE pca.paper_id=p.id AND pca.owner_user_id=$1 AND pca.category_label IS NOT NULL), '[]'::jsonb) AS categories,
       COALESCE((SELECT jsonb_agg(DISTINCT pk.topic ORDER BY pk.topic)
                 FROM public.paper_keywords pk
                 WHERE pk.paper_id=p.id AND pk.owner_user_id=$1), '[]'::jsonb) AS topics,
       COALESCE((SELECT jsonb_agg(DISTINCT pk.keyword ORDER BY pk.keyword)
                 FROM public.paper_keywords pk
                 WHERE pk.paper_id=p.id AND pk.owner_user_id=$1), '[]'::jsonb) AS keywords,
       COALESCE((SELECT jsonb_agg(DISTINCT paf.label ORDER BY paf.label)
                 FROM public.paper_analysis_facets paf
                 WHERE paf.paper_id=p.id AND paf.owner_user_id=$1 AND paf.facet_type='objective_verb'), '[]'::jsonb) AS objectives,
       CASE
         WHEN COALESCE(pts.el,0)=1 THEN 'EL'
         WHEN COALESCE(pts.eli,0)=1 THEN 'ELI'
         WHEN COALESCE(pts.lae,0)=1 THEN 'LAE'
         WHEN COALESCE(pts.other,0)=1 THEN 'OTHER'
         ELSE NULL
       END AS track
     FROM public.papers p
     JOIN public.paper_content pc ON pc.paper_id=p.id AND pc.owner_user_id=$1
     JOIN public.ingestion_runs ir ON ir.id=pc.ingestion_run_id AND ir.owner_user_id=$1
     LEFT JOIN public.research_folders rf ON rf.id=ir.folder_id AND rf.owner_user_id=$1
     LEFT JOIN public.paper_tracks_single pts ON pts.paper_id=p.id AND pts.owner_user_id=$1
     WHERE p.owner_user_id=$1
       AND COALESCE(rf.project_id, CASE WHEN ir.input_payload->>'project_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN (ir.input_payload->>'project_id')::uuid END)=$2
       AND ir.status='succeeded' AND ir.trashed_at IS NULL
     ORDER BY p.id ASC`,
    [ownerUserId, projectId]
  );
  return result.rows.map(composeDocument);
}

export function semanticSourceHash(documents: SemanticPaperDocument[]): string {
  return sha256(documents.map((paper) => [paper.paperId, paper.runId, paper.folderId, paper.folderName, paper.contentHash].join(":"))
    .sort()
    .join("\n"));
}

export async function loadSemanticPaperDocuments(ownerUserId: string, projectId: string): Promise<SemanticPaperDocument[]> {
  return withCloudSqlOwnerTransaction(ownerUserId, (client) => loadDocumentsWithClient(client, ownerUserId, projectId));
}

export async function loadSemanticMapCoverage(
  ownerUserId: string,
  projectId: string
): Promise<SemanticMapCoverage> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    await assertProject(client, ownerUserId, projectId);
    const result = await client.query<{
      repository_files: string;
      analyzed_files: string;
      eligible_papers: string;
      queued_files: string;
      processing_files: string;
      failed_files: string;
      missing_analysis: string;
    }>(
      `WITH scoped_runs AS (
         SELECT ir.id, ir.status
         FROM public.ingestion_runs ir
         LEFT JOIN public.research_folders rf
           ON rf.id=ir.folder_id AND rf.owner_user_id=$1
         WHERE ir.owner_user_id=$1
           AND ir.trashed_at IS NULL
           AND COALESCE(
             rf.project_id,
             CASE
               WHEN ir.input_payload->>'project_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
               THEN (ir.input_payload->>'project_id')::uuid
             END
           )=$2
       ), eligible AS (
         SELECT DISTINCT p.id AS paper_id, sr.id AS run_id
         FROM scoped_runs sr
         JOIN public.paper_content pc
           ON pc.ingestion_run_id=sr.id AND pc.owner_user_id=$1
         JOIN public.papers p
           ON p.id=pc.paper_id AND p.owner_user_id=$1
         WHERE sr.status='succeeded'
       )
       SELECT
         COUNT(*)::text AS repository_files,
         COUNT(*) FILTER (WHERE sr.status='succeeded')::text AS analyzed_files,
         (SELECT COUNT(DISTINCT paper_id) FROM eligible)::text AS eligible_papers,
         COUNT(*) FILTER (WHERE sr.status='queued')::text AS queued_files,
         COUNT(*) FILTER (WHERE sr.status='processing')::text AS processing_files,
         COUNT(*) FILTER (WHERE sr.status='failed')::text AS failed_files,
         GREATEST(
           COUNT(*) FILTER (WHERE sr.status='succeeded') -
           (SELECT COUNT(DISTINCT run_id) FROM eligible),
           0
         )::text AS missing_analysis
       FROM scoped_runs sr`,
      [ownerUserId, projectId]
    );
    const row = result.rows[0];
    return {
      repositoryFiles: Number(row?.repository_files ?? 0),
      analyzedFiles: Number(row?.analyzed_files ?? 0),
      eligiblePapers: Number(row?.eligible_papers ?? 0),
      queuedFiles: Number(row?.queued_files ?? 0),
      processingFiles: Number(row?.processing_files ?? 0),
      failedFiles: Number(row?.failed_files ?? 0),
      missingAnalysis: Number(row?.missing_analysis ?? 0),
    };
  });
}

export interface StoredEmbedding {
  paperId: string;
  embedding: number[];
}

export async function loadCachedSemanticEmbeddings(
  ownerUserId: string,
  projectId: string,
  documents: SemanticPaperDocument[],
  model: string
): Promise<Map<string, number[]>> {
  if (documents.length === 0) return new Map();
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query<{ paper_id: string; embedding: string }>(
      `SELECT paper_id::text, embedding::text
       FROM public.paper_semantic_embeddings
       WHERE owner_user_id=$1 AND project_id=$2 AND representation_version=$3 AND embedding_model=$4
         AND (paper_id::text, content_hash) IN (
           SELECT * FROM unnest($5::text[], $6::text[])
         )`,
      [ownerUserId, projectId, SEMANTIC_REPRESENTATION_VERSION, model,
        documents.map((paper) => paper.paperId), documents.map((paper) => paper.contentHash)]
    );
    return new Map(result.rows.map((row) => [String(row.paper_id), row.embedding.slice(1, -1).split(",").map(Number)]));
  });
}

export async function storeSemanticEmbeddings(
  ownerUserId: string,
  projectId: string,
  documents: SemanticPaperDocument[],
  embeddings: Map<string, number[]>,
  model: string,
  dimensions: number
): Promise<void> {
  await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    for (const paper of documents) {
      const embedding = embeddings.get(paper.paperId);
      if (!embedding) continue;
      await client.query(
        `INSERT INTO public.paper_semantic_embeddings
          (owner_user_id,project_id,folder_id,paper_id,ingestion_run_id,content_hash,representation_version,
           embedding_model,embedding_dimensions,embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::vector)
         ON CONFLICT (owner_user_id,paper_id,representation_version,embedding_model,content_hash)
         DO UPDATE SET project_id=EXCLUDED.project_id,folder_id=EXCLUDED.folder_id,
           ingestion_run_id=EXCLUDED.ingestion_run_id,updated_at=now()`,
        [ownerUserId, projectId, paper.folderId, paper.paperId, paper.runId, paper.contentHash,
          SEMANTIC_REPRESENTATION_VERSION, model, dimensions, `[${embedding.join(",")}]`]
      );
      await client.query(
        `DELETE FROM public.paper_semantic_embeddings
         WHERE owner_user_id=$1 AND paper_id=$2 AND representation_version=$3 AND embedding_model=$4 AND content_hash<>$5`,
        [ownerUserId, paper.paperId, SEMANTIC_REPRESENTATION_VERSION, model, paper.contentHash]
      );
    }
  });
}

export async function createSemanticMapJob(ownerUserId: string, projectId: string, sourceHash: string, paperCount: number): Promise<string> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    await assertProject(client, ownerUserId, projectId);
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM public.repository_semantic_maps
       WHERE owner_user_id=$1 AND project_id=$2 AND source_hash=$3 AND status IN ('queued','processing')
       ORDER BY created_at DESC LIMIT 1`, [ownerUserId, projectId, sourceHash]
    );
    if (existing.rows[0]) return String(existing.rows[0].id);
    const recent = await client.query<{ id: string }>(
      `SELECT id FROM public.repository_semantic_maps
       WHERE owner_user_id=$1 AND project_id=$2 AND source_hash=$3 AND status='succeeded'
         AND created_at > now() - interval '45 seconds'
       ORDER BY created_at DESC LIMIT 1`, [ownerUserId, projectId, sourceHash]
    );
    if (recent.rows[0]) return String(recent.rows[0].id);
    const id = randomUUID();
    await client.query(
      `INSERT INTO public.repository_semantic_maps
       (id,owner_user_id,project_id,status,source_hash,representation_version,paper_count,progress_total)
       VALUES ($1,$2,$3,'queued',$4,$5,$6,$6)`,
      [id, ownerUserId, projectId, sourceHash, SEMANTIC_REPRESENTATION_VERSION, paperCount]
    );
    return id;
  });
}

export async function claimSemanticMapJob(ownerUserId: string, mapId: string): Promise<{ projectId: string; sourceHash: string } | null> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query<{ project_id: string; source_hash: string }>(
      `UPDATE public.repository_semantic_maps SET status='processing',progress_stage='preparing_documents',updated_at=now()
       WHERE id=$1 AND owner_user_id=$2 AND status='queued' RETURNING project_id::text, source_hash`, [mapId, ownerUserId]
    );
    return result.rows[0] ? { projectId: String(result.rows[0].project_id), sourceHash: String(result.rows[0].source_hash) } : null;
  });
}

export async function updateSemanticMapProgress(ownerUserId: string, mapId: string, stage: string, current: number, total: number): Promise<void> {
  await withCloudSqlOwnerTransaction(ownerUserId, (client) => client.query(
    `UPDATE public.repository_semantic_maps SET progress_stage=$3,progress_current=$4,progress_total=$5,updated_at=now()
     WHERE id=$1 AND owner_user_id=$2`, [mapId, ownerUserId, stage, current, total]
  ).then(() => undefined));
}

export async function completeSemanticMap(
  ownerUserId: string,
  mapId: string,
  projectId: string,
  sourceHash: string,
  projection: { algorithm: string; parameters: Record<string, number>; quality: Record<string, number> },
  clusters: SemanticMapCluster[],
  points: SemanticMapPoint[],
  edges: SemanticMapEdge[]
): Promise<void> {
  await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const current = await client.query<{ source_hash: string }>(
      `SELECT source_hash FROM public.repository_semantic_maps WHERE id=$1 AND owner_user_id=$2 FOR UPDATE`, [mapId, ownerUserId]
    );
    if (!current.rows[0] || current.rows[0].source_hash !== sourceHash) throw new Error("Repository changed while the map was generated. Update it again.");
    for (const point of points) {
      await client.query(
        `INSERT INTO public.repository_semantic_points
         (map_id,owner_user_id,project_id,paper_id,ingestion_run_id,folder_id,x,y,cluster_id,title,year,folder_name,categories,topics,keywords,metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb)`,
        [mapId, ownerUserId, projectId, point.paperId, point.runId, point.folderId, point.x, point.y, point.clusterId,
          point.title, point.year, point.folderName, JSON.stringify(point.categories), JSON.stringify(point.topics),
          JSON.stringify(point.keywords), JSON.stringify({ track: point.track })]
      );
    }
    for (const edge of edges) {
      const [source, target] = BigInt(edge.sourcePaperId) < BigInt(edge.targetPaperId)
        ? [edge.sourcePaperId, edge.targetPaperId] : [edge.targetPaperId, edge.sourcePaperId];
      await client.query(
        `INSERT INTO public.repository_semantic_edges
         (map_id,owner_user_id,project_id,source_paper_id,target_paper_id,cosine_similarity,edge_rank,shared_signals)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
        [mapId, ownerUserId, projectId, source, target, edge.similarity, edge.rank, JSON.stringify(edge.sharedSignals)]
      );
    }
    await client.query(
      `UPDATE public.repository_semantic_maps SET status='succeeded',projection_algorithm=$3,
       projection_version='semantic-projection-v1',projection_parameters=$4::jsonb,quality_metrics=$5::jsonb,
       clusters=$6::jsonb,progress_stage='published',progress_current=paper_count,completed_at=now(),updated_at=now()
       WHERE id=$1 AND owner_user_id=$2`,
      [mapId, ownerUserId, projection.algorithm, JSON.stringify(projection.parameters), JSON.stringify(projection.quality), JSON.stringify(clusters)]
    );
    await client.query(
      `DELETE FROM public.repository_semantic_maps
       WHERE owner_user_id=$1 AND project_id=$2 AND id IN (
         SELECT id FROM public.repository_semantic_maps
         WHERE owner_user_id=$1 AND project_id=$2 AND status IN ('succeeded','failed','canceled')
         ORDER BY created_at DESC OFFSET 6
       )`,
      [ownerUserId, projectId]
    );
  });
}

export async function failSemanticMap(ownerUserId: string, mapId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await withCloudSqlOwnerTransaction(ownerUserId, (client) => client.query(
    `UPDATE public.repository_semantic_maps SET status='failed',progress_stage='failed',error_message=$3,
     completed_at=now(),updated_at=now() WHERE id=$1 AND owner_user_id=$2`, [mapId, ownerUserId, message.slice(0, 1000)]
  ).then(() => undefined));
}

function mapSemanticMap(row: Record<string, unknown>, points: SemanticMapPoint[], edges: SemanticMapEdge[], stale: boolean): RepositorySemanticMap {
  return {
    mapId: String(row.id), projectId: String(row.project_id), status: row.status as RepositorySemanticMap["status"], stale,
    sourceHash: String(row.source_hash),
    progress: { stage: String(row.progress_stage ?? "queued"), current: Number(row.progress_current ?? 0), total: Number(row.progress_total ?? 0) },
    projection: { algorithm: (row.projection_algorithm as RepositorySemanticMap["projection"]["algorithm"]) ?? null,
      version: typeof row.projection_version === "string" ? row.projection_version : null,
      parameters: (row.projection_parameters as Record<string, number>) ?? {} },
    quality: (row.quality_metrics as Record<string, number>) ?? {},
    clusters: Array.isArray(row.clusters) ? row.clusters as SemanticMapCluster[] : [], points, edges,
    error: typeof row.error_message === "string" ? row.error_message : null,
    createdAt: String(row.created_at), completedAt: row.completed_at ? String(row.completed_at) : null,
  };
}

export async function getSemanticMap(ownerUserId: string, projectId: string, mapId?: string): Promise<RepositorySemanticMap | null> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const documents = await loadDocumentsWithClient(client, ownerUserId, projectId);
    const sourceHash = semanticSourceHash(documents);
    const values: unknown[] = [ownerUserId, projectId];
    let condition = "owner_user_id=$1 AND project_id=$2";
    if (mapId) { values.push(mapId); condition += ` AND id=$${values.length}`; }
    const result = await client.query<Record<string, unknown>>(
      `SELECT * FROM public.repository_semantic_maps WHERE ${condition}
       ORDER BY CASE status WHEN 'processing' THEN 0 WHEN 'queued' THEN 1 WHEN 'succeeded' THEN 2 ELSE 3 END, created_at DESC LIMIT 1`, values
    );
    const row = result.rows[0];
    if (!row) return null;
    let displayRow = row;
    if (!mapId && row.status !== "succeeded") {
      const successful = await client.query<Record<string, unknown>>(
        `SELECT * FROM public.repository_semantic_maps WHERE owner_user_id=$1 AND project_id=$2 AND status='succeeded'
         ORDER BY created_at DESC LIMIT 1`, [ownerUserId, projectId]
      );
      if (successful.rows[0]) displayRow = { ...successful.rows[0], active_job: row };
    }
    const pointResult = await client.query<Record<string, unknown>>(
      `SELECT * FROM public.repository_semantic_points WHERE map_id=$1 AND owner_user_id=$2 ORDER BY paper_id`, [displayRow.id, ownerUserId]
    );
    const edgeResult = await client.query<Record<string, unknown>>(
      `SELECT * FROM public.repository_semantic_edges WHERE map_id=$1 AND owner_user_id=$2 ORDER BY cosine_similarity DESC`, [displayRow.id, ownerUserId]
    );
    const points: SemanticMapPoint[] = pointResult.rows.map((point) => ({
      paperId: String(point.paper_id), runId: point.ingestion_run_id ? String(point.ingestion_run_id) : null,
      folderId: point.folder_id ? String(point.folder_id) : null, x: Number(point.x), y: Number(point.y),
      clusterId: point.cluster_id === null ? null : Number(point.cluster_id), title: String(point.title), year: String(point.year ?? "Unknown"),
      folderName: point.folder_name ? String(point.folder_name) : null, categories: stringList(point.categories), topics: stringList(point.topics),
      keywords: stringList(point.keywords), track: typeof (point.metadata as Record<string, unknown> | null)?.track === "string" ? String((point.metadata as Record<string, unknown>).track) : null,
    }));
    const edges: SemanticMapEdge[] = edgeResult.rows.map((edge) => ({
      sourcePaperId: String(edge.source_paper_id), targetPaperId: String(edge.target_paper_id), similarity: Number(edge.cosine_similarity),
      rank: Number(edge.edge_rank), sharedSignals: (edge.shared_signals as SemanticMapEdge["sharedSignals"]) ?? { categories: [], topics: [], keywords: [], methods: [] },
    }));
    const mapped = mapSemanticMap(displayRow, points, edges, String(displayRow.source_hash) !== sourceHash);
    const activeJob = (displayRow as Record<string, unknown>).active_job as Record<string, unknown> | undefined;
    if (activeJob) mapped.progress = { stage: String(activeJob.progress_stage), current: Number(activeJob.progress_current), total: Number(activeJob.progress_total) };
    return mapped;
  });
}

export async function getSemanticMapJob(ownerUserId: string, mapId: string): Promise<RepositorySemanticMap | null> {
  const projectId = await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query<{ project_id: string }>(
      `SELECT project_id::text FROM public.repository_semantic_maps WHERE id=$1 AND owner_user_id=$2 LIMIT 1`,
      [mapId, ownerUserId]
    );
    return result.rows[0] ? String(result.rows[0].project_id) : null;
  });
  return projectId ? getSemanticMap(ownerUserId, projectId, mapId) : null;
}
