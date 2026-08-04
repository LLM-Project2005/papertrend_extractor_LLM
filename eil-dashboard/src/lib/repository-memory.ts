import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { getOpenAIConfig, getRepositoryEmbeddingConfig } from "@/lib/server-env";
import type { RepositoryPaper } from "@/lib/repository-chat";

const DIGEST_VERSION = "repository-digest-v1";
const EMBEDDING_VERSION = "repository-embedding-v1";

export interface RepositoryMemoryScope {
  ownerUserId: string;
  projectId: string;
  folderId: string | null;
}

export interface RepositoryMemoryHit {
  paperId: string;
  section: string;
  content: string;
  score: number;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function digestForPaper(paper: RepositoryPaper): string {
  return [
    `# ${paper.title}`,
    `- Paper ID: ${paper.paperId}`,
    `- Year: ${paper.year}`,
    `- Topics: ${[...paper.topics.keys()].join(", ") || "Not available"}`,
    `- Keywords: ${[...paper.keywords.keys()].join(", ") || "Not available"}`,
    paper.abstract ? `## Abstract\n${paper.abstract}` : "",
    paper.methods ? `## Methods\n${paper.methods}` : "",
    paper.results ? `## Results\n${paper.results}` : "",
    paper.conclusion ? `## Conclusion\n${paper.conclusion}` : "",
  ].filter(Boolean).join("\n\n");
}

function chunksForPaper(paper: RepositoryPaper): Array<{ section: string; content: string }> {
  const sections = [
    ["abstract", paper.abstract],
    ["methods", paper.methods],
    ["results", paper.results],
    ["conclusion", paper.conclusion],
    ["body", paper.content],
  ] as const;
  const chunks: Array<{ section: string; content: string }> = [];
  for (const [section, raw] of sections) {
    const content = raw.trim();
    if (!content) continue;
    const size = 2_800;
    const overlap = 280;
    for (let start = 0; start < content.length; start += size - overlap) {
      const value = content.slice(start, start + size).trim();
      if (value) chunks.push({ section, content: value });
      if (start + size >= content.length) break;
    }
  }
  return chunks;
}

async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (texts.length === 0) return [];
  const provider = getOpenAIConfig();
  if (!provider || !provider.baseUrl.includes("openrouter.ai")) return null;
  const config = getRepositoryEmbeddingConfig();
  const response = await fetch(`${provider.baseUrl}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify({ model: config.model, input: texts, dimensions: config.dimensions }),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
  const ordered = [...(payload.data ?? [])].sort((left, right) => left.index - right.index);
  return ordered.length === texts.length ? ordered.map((item) => item.embedding) : null;
}

async function upsertPaperMemory(
  client: PoolClient,
  scope: RepositoryMemoryScope,
  paper: RepositoryPaper
): Promise<number> {
  const digest = digestForPaper(paper);
  await client.query(
    `INSERT INTO paper_retrieval_documents
       (owner_user_id, project_id, folder_id, paper_id, ingestion_run_id, digest_markdown, content_hash, digest_version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (owner_user_id, paper_id, digest_version) DO UPDATE SET
       project_id=EXCLUDED.project_id, folder_id=EXCLUDED.folder_id,
       ingestion_run_id=EXCLUDED.ingestion_run_id, digest_markdown=EXCLUDED.digest_markdown,
       content_hash=EXCLUDED.content_hash, updated_at=now()`,
    [scope.ownerUserId, scope.projectId, scope.folderId || paper.folderId || null, paper.paperId, paper.runId, digest, sha256(digest), DIGEST_VERSION]
  );
  const chunks = chunksForPaper(paper);
  const config = getRepositoryEmbeddingConfig();
  for (let offset = 0; offset < chunks.length; offset += config.batchSize) {
    const batch = chunks.slice(offset, offset + config.batchSize);
    const embeddings = await embedTexts(batch.map((chunk) => chunk.content)).catch(() => null);
    for (let index = 0; index < batch.length; index += 1) {
      const chunk = batch[index];
      const embedding = embeddings?.[index];
      await client.query(
        `INSERT INTO paper_retrieval_chunks
           (owner_user_id, project_id, folder_id, paper_id, ingestion_run_id, section, chunk_index,
            content, content_hash, token_count, embedding_model, embedding_version, embedding)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::vector)
         ON CONFLICT (owner_user_id, paper_id, section, chunk_index, content_hash) DO UPDATE SET
           project_id=EXCLUDED.project_id, folder_id=EXCLUDED.folder_id,
           ingestion_run_id=EXCLUDED.ingestion_run_id, content=EXCLUDED.content,
           embedding_model=COALESCE(EXCLUDED.embedding_model, paper_retrieval_chunks.embedding_model),
           embedding_version=COALESCE(EXCLUDED.embedding_version, paper_retrieval_chunks.embedding_version),
           embedding=COALESCE(EXCLUDED.embedding, paper_retrieval_chunks.embedding), updated_at=now()`,
        [scope.ownerUserId, scope.projectId, scope.folderId || paper.folderId || null, paper.paperId, paper.runId,
          chunk.section, offset + index, chunk.content, sha256(chunk.content), Math.ceil(chunk.content.length / 4),
          embedding ? config.model : null, embedding ? EMBEDDING_VERSION : null,
          embedding ? `[${embedding.join(",")}]` : null]
      );
    }
  }
  return chunks.length;
}

export async function syncRepositoryMemory(
  scope: RepositoryMemoryScope,
  papers: RepositoryPaper[]
): Promise<{ papers: number; chunks: number }> {
  return withCloudSqlOwnerTransaction(scope.ownerUserId, async (client) => {
    let chunks = 0;
    for (const paper of papers) chunks += await upsertPaperMemory(client, scope, paper);
    return { papers: papers.length, chunks };
  });
}

export async function hybridRepositorySearch(
  scope: RepositoryMemoryScope,
  query: string,
  limit = 20
): Promise<RepositoryMemoryHit[]> {
  const embedding = (await embedTexts([query]).catch(() => null))?.[0] ?? null;
  return withCloudSqlOwnerTransaction(scope.ownerUserId, async (client) => {
    const result = await client.query<RepositoryMemoryHit & { paper_id: string; rank_score: number }>(
      `WITH lexical AS (
         SELECT id, row_number() OVER (ORDER BY ts_rank_cd(to_tsvector('simple', content), plainto_tsquery('simple', $4)) DESC) AS rank
         FROM paper_retrieval_chunks
         WHERE owner_user_id=$1 AND project_id=$2 AND ($3::uuid IS NULL OR folder_id=$3)
           AND to_tsvector('simple', content) @@ plainto_tsquery('simple', $4)
         LIMIT 80
       ), semantic AS (
         SELECT id, row_number() OVER (ORDER BY embedding <=> $5::vector) AS rank
         FROM paper_retrieval_chunks
         WHERE $5::text IS NOT NULL AND owner_user_id=$1 AND project_id=$2
           AND ($3::uuid IS NULL OR folder_id=$3) AND embedding IS NOT NULL
         LIMIT 80
       )
       SELECT c.paper_id::text AS "paperId", c.section, c.content,
              (COALESCE(1.0/(60+l.rank),0)+COALESCE(1.0/(60+s.rank),0))::float8 AS score
       FROM paper_retrieval_chunks c
       LEFT JOIN lexical l ON l.id=c.id LEFT JOIN semantic s ON s.id=c.id
       WHERE c.owner_user_id=$1 AND c.project_id=$2 AND ($3::uuid IS NULL OR c.folder_id=$3)
         AND (l.id IS NOT NULL OR s.id IS NOT NULL)
       ORDER BY score DESC LIMIT $6`,
      [scope.ownerUserId, scope.projectId, scope.folderId, query, embedding ? `[${embedding.join(",")}]` : null, Math.max(1, Math.min(limit, 100))]
    );
    return result.rows;
  });
}
