import { getOpenAIConfig, getRepositoryEmbeddingConfig } from "@/lib/server-env";
import {
  SEMANTIC_REPRESENTATION_VERSION,
  claimSemanticMapJob,
  completeSemanticMap,
  failSemanticMap,
  loadCachedSemanticEmbeddings,
  loadSemanticPaperDocuments,
  semanticSourceHash,
  storeSemanticEmbeddings,
  updateSemanticMapProgress,
} from "@/lib/semantic-map-repository";
import {
  buildSimilarityEdges,
  clusterEmbeddings,
  projectEmbeddings,
} from "@/lib/semantic-map-math";
import type { SemanticMapCluster, SemanticMapEdge, SemanticMapPoint, SemanticPaperDocument } from "@/types/semantic-map";

const EMBEDDING_ATTEMPTS = 3;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function embedBatch(texts: string[], model: string, dimensions: number): Promise<number[][]> {
  const provider = getOpenAIConfig();
  if (!provider) throw new Error("Embedding provider is not configured.");
  let lastError = "Embedding request failed.";
  for (let attempt = 1; attempt <= EMBEDDING_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${provider.baseUrl}/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
        body: JSON.stringify({ model, input: texts, dimensions }),
      });
      if (response.ok) {
        const payload = await response.json() as { data?: Array<{ index: number; embedding: number[] }> };
        const rows = [...(payload.data ?? [])].sort((left, right) => left.index - right.index).map((item) => item.embedding);
        if (rows.length !== texts.length || rows.some((row) => row.length !== dimensions)) {
          throw new Error("Embedding provider returned an unexpected vector shape.");
        }
        return rows;
      }
      lastError = `Embedding provider returned ${response.status}.`;
      if (response.status < 500 && response.status !== 429) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < EMBEDDING_ATTEMPTS) await sleep(400 * 2 ** (attempt - 1));
  }
  throw new Error(lastError);
}

function intersect(left: string[], right: string[], limit = 6): string[] {
  const rightSet = new Set(right.map((item) => item.toLocaleLowerCase()));
  return left.filter((item) => rightSet.has(item.toLocaleLowerCase())).slice(0, limit);
}

function methodTerms(value: string): string[] {
  const vocabulary = [
    "mixed methods", "qualitative", "quantitative", "experiment", "survey", "interview",
    "case study", "corpus", "regression", "content analysis", "quasi-experimental", "longitudinal",
  ];
  const normalized = value.toLocaleLowerCase();
  return vocabulary.filter((term) => normalized.includes(term));
}

function topTerms(papers: SemanticPaperDocument[]): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const paper of papers) {
    for (const label of [...paper.categories, ...paper.topics, ...paper.keywords.slice(0, 8)]) {
      const key = label.toLocaleLowerCase();
      const current = counts.get(key);
      counts.set(key, { label, count: (current?.count ?? 0) + 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 5).map((item) => item.label);
}

async function improveClusterLabels(clusters: SemanticMapCluster[]): Promise<SemanticMapCluster[]> {
  if (process.env.SEMANTIC_MAP_LLM_LABELS_ENABLED !== "true") return clusters;
  const provider = getOpenAIConfig("SEMANTIC_MAP_LABEL");
  if (!provider || clusters.length <= 1) return clusters;
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: "Name each research-paper neighborhood from only the supplied terms. Return JSON {labels:[{id,label}]}. Use concise, neutral labels of at most six words. Do not infer citations, causality, or agreement." },
          { role: "user", content: JSON.stringify(clusters.map(({ id, terms, paperCount }) => ({ id, terms, paperCount }))) },
        ],
      }),
    });
    if (!response.ok) return clusters;
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const parsed = JSON.parse(payload.choices?.[0]?.message?.content ?? "{}") as { labels?: Array<{ id?: number; label?: string }> };
    const labels = new Map((parsed.labels ?? []).filter((item) => Number.isInteger(item.id) && item.label?.trim()).map((item) => [item.id!, item.label!.trim().slice(0, 80)]));
    return clusters.map((cluster) => labels.has(cluster.id) ? { ...cluster, label: labels.get(cluster.id)!, source: "llm" } : cluster);
  } catch {
    return clusters;
  }
}

export async function processSemanticMapJob(ownerUserId: string, mapId: string): Promise<{ skipped: boolean }> {
  const job = await claimSemanticMapJob(ownerUserId, mapId);
  if (!job) return { skipped: true };
  try {
    const documents = await loadSemanticPaperDocuments(ownerUserId, job.projectId);
    const sourceHash = semanticSourceHash(documents);
    if (sourceHash !== job.sourceHash) throw new Error("Repository changed before generation started. Please update the map again.");
    const config = getRepositoryEmbeddingConfig();
    if (config.dimensions !== 1536) throw new Error("Semantic maps currently require 1,536-dimensional embeddings.");
    await updateSemanticMapProgress(ownerUserId, mapId, "embedding_papers", 0, documents.length);
    const embeddings = await loadCachedSemanticEmbeddings(ownerUserId, job.projectId, documents, config.model);
    const missing = documents.filter((paper) => !embeddings.has(paper.paperId));
    for (let offset = 0; offset < missing.length; offset += config.batchSize) {
      const batch = missing.slice(offset, offset + config.batchSize);
      const vectors = await embedBatch(batch.map((paper) => paper.documentText), config.model, config.dimensions);
      batch.forEach((paper, index) => embeddings.set(paper.paperId, vectors[index]));
      await storeSemanticEmbeddings(ownerUserId, job.projectId, batch, embeddings, config.model, config.dimensions);
      await updateSemanticMapProgress(ownerUserId, mapId, "embedding_papers", Math.min(missing.length, offset + batch.length), documents.length);
    }
    const vectors = documents.map((paper) => embeddings.get(paper.paperId)).filter((value): value is number[] => Boolean(value));
    if (vectors.length !== documents.length) throw new Error("Not every paper received an embedding.");

    await updateSemanticMapProgress(ownerUserId, mapId, "computing_relationships", documents.length, documents.length);
    const edgeIndexes = buildSimilarityEdges(vectors);
    const clustering = clusterEmbeddings(vectors);
    let projection;
    try {
      projection = projectEmbeddings(vectors);
    } catch (error) {
      if (vectors.length <= 1) throw error;
      projection = projectEmbeddings(vectors, 42, true);
      projection.quality.umapFallback = 1;
    }
    projection.quality.clusterSilhouette = clustering.score;
    projection.quality.edgeCount = edgeIndexes.length;
    projection.quality.disconnectedPapers = documents.filter((_, index) => !edgeIndexes.some((edge) => edge.source === index || edge.target === index)).length;

    const points: SemanticMapPoint[] = documents.map((paper, index) => ({
      paperId: paper.paperId, runId: paper.runId, folderId: paper.folderId,
      x: projection.coordinates[index][0], y: projection.coordinates[index][1], clusterId: clustering.assignments[index] ?? 0,
      title: paper.title, year: paper.year, folderName: paper.folderName, categories: paper.categories,
      topics: paper.topics, keywords: paper.keywords, track: paper.track,
    }));
    const edges: SemanticMapEdge[] = edgeIndexes.map((edge) => ({
      sourcePaperId: documents[edge.source].paperId, targetPaperId: documents[edge.target].paperId,
      similarity: edge.similarity, rank: edge.rank,
      sharedSignals: {
        categories: intersect(documents[edge.source].categories, documents[edge.target].categories),
        topics: intersect(documents[edge.source].topics, documents[edge.target].topics),
        keywords: intersect(documents[edge.source].keywords, documents[edge.target].keywords),
        methods: intersect(methodTerms(documents[edge.source].methods), methodTerms(documents[edge.target].methods)),
      },
    }));
    const ids = [...new Set(clustering.assignments)].sort((a, b) => a - b);
    let clusters: SemanticMapCluster[] = ids.map((id) => {
      const papers = documents.filter((_, index) => clustering.assignments[index] === id);
      const terms = topTerms(papers);
      return { id, label: terms.slice(0, 2).join(" and ") || `Neighborhood ${id + 1}`, paperCount: papers.length, terms, source: "deterministic" };
    });
    await updateSemanticMapProgress(ownerUserId, mapId, "labeling_neighborhoods", documents.length, documents.length);
    clusters = await improveClusterLabels(clusters);
    const latestDocuments = await loadSemanticPaperDocuments(ownerUserId, job.projectId);
    if (semanticSourceHash(latestDocuments) !== sourceHash) {
      throw new Error("Repository changed while the map was generated. Please update the map again.");
    }
    await completeSemanticMap(ownerUserId, mapId, job.projectId, sourceHash,
      { algorithm: projection.algorithm, parameters: projection.parameters, quality: projection.quality },
      clusters, points, edges);
    return { skipped: false };
  } catch (error) {
    await failSemanticMap(ownerUserId, mapId, error);
    throw error;
  }
}
