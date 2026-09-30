import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { recordAiTokenUsage } from "@/lib/ai-token-usage";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { getOpenAIConfig, getRepositoryEmbeddingConfig } from "@/lib/server-env";
import type { RepositoryPaper } from "@/lib/repository-chat";

const DIGEST_VERSION = "repository-digest-v1";
const EMBEDDING_VERSION = "repository-embedding-v1";
/** An embeddings call that takes longer than this counts as failed; the chunk is stored without a vector. */
const EMBEDDING_TIMEOUT_MS = 20_000;
/** Papers the semantic channel ranks per question. */
export const SEMANTIC_PAPER_LIMIT = 40;

export interface RepositoryMemoryScope {
  ownerUserId: string;
  projectId: string | null;
  folderId: string | null;
}

/**
 * The search index's view of a question: in-scope papers ordered by their
 * closest chunk, and every in-scope paper the index holds at all. A paper
 * missing from `indexedPaperIds` has simply not been indexed yet.
 */
export interface SemanticPaperRanking {
  rankedPaperIds: string[];
  indexedPaperIds: string[];
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
    signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { data?: Array<{ index: number; embedding: number[] }>; usage?: unknown };
  // Counted in the spend of the request this indexing or search is part of.
  recordAiTokenUsage(payload.usage, config.model);
  const ordered = [...(payload.data ?? [])].sort((left, right) => left.index - right.index);
  return ordered.length === texts.length ? ordered.map((item) => item.embedding) : null;
}

interface PreparedPaper {
  paper: RepositoryPaper;
  chunks: Array<{ section: string; content: string }>;
  vectors: Array<number[] | null>;
}

/** Chunks and their embeddings, computed before any transaction opens. */
async function preparePaper(paper: RepositoryPaper): Promise<PreparedPaper> {
  const chunks = chunksForPaper(paper);
  const config = getRepositoryEmbeddingConfig();
  const vectors: Array<number[] | null> = [];
  for (let offset = 0; offset < chunks.length; offset += config.batchSize) {
    const batch = chunks.slice(offset, offset + config.batchSize);
    const embeddings = await embedTexts(batch.map((chunk) => chunk.content)).catch(() => null);
    batch.forEach((_, index) => vectors.push(embeddings?.[index] ?? null));
  }
  return { paper, chunks, vectors };
}

/**
 * Replaces a paper's chunks. Their unique key includes the content hash, so
 * upserting alone left a re-analysed paper's old chunks beside the new ones.
 */
async function writePaperMemory(
  client: PoolClient,
  scope: RepositoryMemoryScope,
  { paper, chunks, vectors }: PreparedPaper
): Promise<{ chunks: number; embedded: number }> {
  await client.query(
    `DELETE FROM paper_retrieval_chunks WHERE owner_user_id=$1 AND paper_id=$2`,
    [scope.ownerUserId, paper.paperId]
  );
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
  const config = getRepositoryEmbeddingConfig();
  let embedded = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    const embedding = vectors[index];
    if (embedding) embedded += 1;
    await client.query(
      `INSERT INTO paper_retrieval_chunks
         (owner_user_id, project_id, folder_id, paper_id, ingestion_run_id, section, chunk_index,
          content, content_hash, token_count, embedding_model, embedding_version, embedding)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::vector)
       ON CONFLICT (owner_user_id, paper_id, section, chunk_index, content_hash) DO UPDATE SET
         project_id=EXCLUDED.project_id, folder_id=EXCLUDED.folder_id,
         ingestion_run_id=EXCLUDED.ingestion_run_id, content=EXCLUDED.content,
         embedding_model=EXCLUDED.embedding_model, embedding_version=EXCLUDED.embedding_version,
         embedding=EXCLUDED.embedding, updated_at=now()`,
      [scope.ownerUserId, scope.projectId, scope.folderId || paper.folderId || null, paper.paperId, paper.runId,
        chunk.section, index, chunk.content, sha256(chunk.content), Math.ceil(chunk.content.length / 4),
        embedding ? config.model : null, embedding ? EMBEDDING_VERSION : null,
        embedding ? `[${embedding.join(",")}]` : null]
    );
  }
  return { chunks: chunks.length, embedded };
}

/** Indexes the papers afresh: their old chunks go, the current ones replace them. */
export async function syncRepositoryMemory(
  scope: RepositoryMemoryScope,
  papers: RepositoryPaper[]
): Promise<{ papers: number; chunks: number; embedded: number }> {
  const prepared: PreparedPaper[] = [];
  for (const paper of papers) prepared.push(await preparePaper(paper));
  return withCloudSqlOwnerTransaction(scope.ownerUserId, async (client) => {
    let chunks = 0;
    let embedded = 0;
    for (const paper of prepared) {
      const written = await writePaperMemory(client, scope, paper);
      chunks += written.chunks;
      embedded += written.embedded;
    }
    return { papers: papers.length, chunks, embedded };
  });
}

/**
 * The semantic channel: the nearest chunks, then each paper by its closest
 * one. The ORDER BY on the distance itself, with a LIMIT, is what lets
 * Postgres use the vector index; ordering inside row_number() did not.
 */
export const SEMANTIC_PAPER_SQL = `SELECT paper_id::text AS paper_id
  FROM (
    SELECT paper_id, embedding <=> $4::vector AS distance
    FROM paper_retrieval_chunks
    WHERE owner_user_id=$1 AND ($2::uuid IS NULL OR project_id=$2) AND ($3::uuid IS NULL OR folder_id=$3)
      AND embedding IS NOT NULL
    ORDER BY embedding <=> $4::vector
    LIMIT 200
  ) nearest
  GROUP BY paper_id
  ORDER BY min(distance)
  LIMIT $5`;

export const INDEXED_PAPERS_SQL = `SELECT DISTINCT paper_id::text AS paper_id
  FROM paper_retrieval_chunks
  WHERE owner_user_id=$1 AND ($2::uuid IS NULL OR project_id=$2) AND ($3::uuid IS NULL OR folder_id=$3)
    AND embedding IS NOT NULL`;

/**
 * Ranks the in-scope papers by meaning, for fusion with the in-memory ranking
 * (docs/32, 2.3). Null when no ranking could be made - no embeddings provider,
 * or the question could not be embedded - and the in-memory ranking then stands.
 */
export async function semanticPaperRanking(
  scope: RepositoryMemoryScope,
  query: string,
  limit = SEMANTIC_PAPER_LIMIT
): Promise<SemanticPaperRanking | null> {
  const params = [scope.ownerUserId, scope.projectId, scope.folderId];
  const indexed = await withCloudSqlOwnerTransaction(scope.ownerUserId, async (client) =>
    (await client.query<{ paper_id: string }>(INDEXED_PAPERS_SQL, params)).rows.map((row) => row.paper_id)
  );
  // Nothing indexed in scope: no embedding call, and nothing to fuse.
  if (indexed.length === 0) return { rankedPaperIds: [], indexedPaperIds: [] };
  const embedding = (await embedTexts([query]).catch(() => null))?.[0] ?? null;
  if (!embedding) return null;
  const ranked = await withCloudSqlOwnerTransaction(scope.ownerUserId, async (client) =>
    (await client.query<{ paper_id: string }>(SEMANTIC_PAPER_SQL, [
      ...params, `[${embedding.join(",")}]`, Math.max(1, Math.min(limit, 100)),
    ])).rows.map((row) => row.paper_id)
  );
  return { rankedPaperIds: ranked, indexedPaperIds: indexed };
}
