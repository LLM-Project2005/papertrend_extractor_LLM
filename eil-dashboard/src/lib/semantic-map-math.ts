import { PCA } from "ml-pca";
import { UMAP } from "umap-js";

export const SEMANTIC_MAP_SEED = 42;
export const SEMANTIC_MAP_PROJECTION_VERSION = "semantic-projection-v1";

export interface ProjectionResult {
  coordinates: number[][];
  algorithm: "single" | "pca" | "umap";
  parameters: Record<string, number>;
  quality: Record<string, number>;
}

export interface SimilarityEdgeIndex {
  source: number;
  target: number;
  similarity: number;
  rank: number;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function cosineSimilarity(left: number[], right: number[]): number {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm)));
}

function normalizeCoordinates(rows: number[][]): number[][] {
  if (rows.length === 0) return [];
  const xs = rows.map((row) => Number.isFinite(row[0]) ? row[0] : 0);
  const ys = rows.map((row) => Number.isFinite(row[1]) ? row[1] : 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xSpan = maxX - minX || 1;
  const ySpan = maxY - minY || 1;
  return rows.map((_, index) => [
    80 + ((xs[index] - minX) / xSpan) * 840,
    80 + ((ys[index] - minY) / ySpan) * 640,
  ]);
}

function euclideanDistance(left: number[], right: number[]): number {
  const dx = left[0] - right[0];
  const dy = left[1] - right[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function nearestIndices(rows: number[][], index: number, count: number, distance: (a: number[], b: number[]) => number): number[] {
  return rows
    .map((row, candidate) => ({ candidate, distance: candidate === index ? Number.POSITIVE_INFINITY : distance(rows[index], row) }))
    .sort((a, b) => a.distance - b.distance || a.candidate - b.candidate)
    .slice(0, count)
    .map((item) => item.candidate);
}

export function neighborhoodPreservation(embeddings: number[][], coordinates: number[][]): number {
  if (embeddings.length < 3) return 1;
  const count = Math.min(5, Math.max(1, Math.floor((embeddings.length - 1) / 2)));
  let overlap = 0;
  for (let index = 0; index < embeddings.length; index += 1) {
    const high = new Set(nearestIndices(embeddings, index, count, (a, b) => 1 - cosineSimilarity(a, b)));
    const low = nearestIndices(coordinates, index, count, euclideanDistance);
    overlap += low.filter((candidate) => high.has(candidate)).length / count;
  }
  return overlap / embeddings.length;
}

function pcaProjection(embeddings: number[][]): { rows: number[][]; explainedVariance: number } {
  if (embeddings.length === 2) return { rows: [[-1, 0], [1, 0]], explainedVariance: 1 };
  const pca = new PCA(embeddings, { center: true, scale: false });
  const rows = pca.predict(embeddings, { nComponents: 2 }).to2DArray();
  const explained = pca.getExplainedVariance().slice(0, 2).reduce((sum, value) => sum + value, 0);
  return { rows, explainedVariance: Number.isFinite(explained) ? explained : 0 };
}

export function projectEmbeddings(embeddings: number[][], seed = SEMANTIC_MAP_SEED, forcePca = false): ProjectionResult {
  if (embeddings.length === 0) {
    return { coordinates: [], algorithm: "single", parameters: { seed }, quality: { neighborhoodPreservation: 1 } };
  }
  if (embeddings.length === 1) {
    return { coordinates: [[500, 400]], algorithm: "single", parameters: { seed }, quality: { neighborhoodPreservation: 1 } };
  }

  if (embeddings.length <= 12 || forcePca) {
    const projected = pcaProjection(embeddings);
    const coordinates = normalizeCoordinates(projected.rows);
    return {
      coordinates,
      algorithm: "pca",
      parameters: { seed, components: 2 },
      quality: {
        explainedVariance: projected.explainedVariance,
        neighborhoodPreservation: neighborhoodPreservation(embeddings, coordinates),
      },
    };
  }

  const nNeighbors = Math.min(10, embeddings.length - 1);
  const minDist = 0.2;
  const umap = new UMAP({
    nComponents: 2,
    nNeighbors,
    minDist,
    distanceFn: (left, right) => 1 - cosineSimilarity(left, right),
    random: seededRandom(seed),
  });
  const coordinates = normalizeCoordinates(umap.fit(embeddings));
  return {
    coordinates,
    algorithm: "umap",
    parameters: { seed, components: 2, nNeighbors, minDist },
    quality: { neighborhoodPreservation: neighborhoodPreservation(embeddings, coordinates) },
  };
}

function percentile(values: number[], fraction: number): number {
  if (values.length === 0) return 1;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
}

export function buildSimilarityEdges(embeddings: number[][], neighbors = 3): SimilarityEdgeIndex[] {
  if (embeddings.length < 2) return [];
  const ranked = embeddings.map((embedding, source) =>
    embeddings
      .map((candidate, target) => ({ target, similarity: source === target ? -1 : cosineSimilarity(embedding, candidate) }))
      .filter((item) => item.target !== source)
      .sort((a, b) => b.similarity - a.similarity || a.target - b.target)
  );
  const threshold = Math.max(0.45, percentile(ranked.flatMap((items) => items.slice(0, neighbors).map((item) => item.similarity)), 0.35));
  const edgeMap = new Map<string, SimilarityEdgeIndex>();
  for (let source = 0; source < ranked.length; source += 1) {
    for (let rank = 0; rank < Math.min(neighbors, ranked[source].length); rank += 1) {
      const candidate = ranked[source][rank];
      const reciprocal = ranked[candidate.target].slice(0, neighbors).some((item) => item.target === source);
      if (!reciprocal && candidate.similarity < Math.max(0.7, threshold)) continue;
      if (candidate.similarity < threshold) continue;
      const left = Math.min(source, candidate.target);
      const right = Math.max(source, candidate.target);
      const key = `${left}:${right}`;
      const existing = edgeMap.get(key);
      const value = { source: left, target: right, similarity: candidate.similarity, rank: rank + 1 };
      if (!existing || value.similarity > existing.similarity) edgeMap.set(key, value);
    }
  }
  return [...edgeMap.values()].sort((a, b) => b.similarity - a.similarity || a.source - b.source || a.target - b.target);
}

interface ClusterResult { assignments: number[]; score: number }

function deterministicKMeans(embeddings: number[][], k: number): number[] {
  const centers: number[][] = [embeddings[0]];
  while (centers.length < k) {
    let bestIndex = 0;
    let bestDistance = -1;
    embeddings.forEach((embedding, index) => {
      const distance = Math.min(...centers.map((center) => 1 - cosineSimilarity(embedding, center)));
      if (distance > bestDistance) { bestDistance = distance; bestIndex = index; }
    });
    centers.push(embeddings[bestIndex]);
  }
  let assignments = embeddings.map(() => 0);
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const next = embeddings.map((embedding) => {
      let best = 0;
      for (let cluster = 1; cluster < centers.length; cluster += 1) {
        if (cosineSimilarity(embedding, centers[cluster]) > cosineSimilarity(embedding, centers[best])) best = cluster;
      }
      return best;
    });
    if (next.every((value, index) => value === assignments[index]) && iteration > 0) break;
    assignments = next;
    for (let cluster = 0; cluster < k; cluster += 1) {
      const members = embeddings.filter((_, index) => assignments[index] === cluster);
      if (members.length === 0) continue;
      centers[cluster] = embeddings[0].map((_, dimension) => members.reduce((sum, row) => sum + row[dimension], 0) / members.length);
    }
  }
  return assignments;
}

function silhouetteScore(embeddings: number[][], assignments: number[]): number {
  const clusters = [...new Set(assignments)];
  if (clusters.length < 2) return 0;
  let total = 0;
  embeddings.forEach((embedding, index) => {
    const own = assignments[index];
    const same = embeddings.filter((_, candidate) => candidate !== index && assignments[candidate] === own);
    const a = same.length ? same.reduce((sum, row) => sum + (1 - cosineSimilarity(embedding, row)), 0) / same.length : 0;
    const alternatives = clusters.filter((cluster) => cluster !== own).map((cluster) => {
      const rows = embeddings.filter((_, candidate) => assignments[candidate] === cluster);
      return rows.reduce((sum, row) => sum + (1 - cosineSimilarity(embedding, row)), 0) / rows.length;
    });
    const b = Math.min(...alternatives);
    total += Math.max(a, b) === 0 ? 0 : (b - a) / Math.max(a, b);
  });
  return total / embeddings.length;
}

export function clusterEmbeddings(embeddings: number[][]): ClusterResult {
  if (embeddings.length < 5) return { assignments: embeddings.map(() => 0), score: 0 };
  const maxK = Math.min(7, Math.max(2, Math.round(Math.sqrt(embeddings.length))));
  let best: ClusterResult = { assignments: embeddings.map(() => 0), score: 0 };
  for (let k = 2; k <= maxK; k += 1) {
    const assignments = deterministicKMeans(embeddings, k);
    const score = silhouetteScore(embeddings, assignments);
    if (score > best.score) best = { assignments, score };
  }
  return best.score >= 0.08 ? best : { assignments: embeddings.map(() => 0), score: best.score };
}
