import { PCA } from "ml-pca";
import { UMAP } from "umap-js";

export const SEMANTIC_MAP_SEED = 42;
/**
 * Rank stamped on links added purely to connect a neighborhood.
 *
 * Nearest-neighbour ranks start at 1 and the stored schema enforces
 * CHECK (edge_rank > 0), so this marker must stay above zero while remaining
 * clearly outside the normal nearest-neighbour range.
 */
export const CLUSTER_BRIDGE_EDGE_RANK = 99;

export const SEMANTIC_MAP_PROJECTION_VERSION = "semantic-projection-v2-euclidean";

export interface ProjectionResult {
  coordinates: number[][];
  algorithm: "single" | "pca" | "umap";
  parameters: Record<string, number>;
  quality: Record<string, number>;
}

export interface SimilarityEdgeIndex {
  source: number;
  target: number;
  distance: number;
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

export const SEMANTIC_MAP_CANVAS = { minX: 40, maxX: 960, minY: 40, maxY: 760 } as const;

/** Percentile span used for scaling so single outliers cannot squash the map. */
const SPREAD_CLIP = 0.03;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

function normalizeCoordinates(rows: number[][]): number[][] {
  if (rows.length === 0) return [];
  const xs = rows.map((row) => (Number.isFinite(row[0]) ? row[0] : 0));
  const ys = rows.map((row) => (Number.isFinite(row[1]) ? row[1] : 0));
  const lowX = percentile(xs, SPREAD_CLIP);
  const highX = percentile(xs, 1 - SPREAD_CLIP);
  const lowY = percentile(ys, SPREAD_CLIP);
  const highY = percentile(ys, 1 - SPREAD_CLIP);
  const xSpan = highX - lowX || Math.max(...xs) - Math.min(...xs) || 1;
  const ySpan = highY - lowY || Math.max(...ys) - Math.min(...ys) || 1;
  const width = SEMANTIC_MAP_CANVAS.maxX - SEMANTIC_MAP_CANVAS.minX;
  const height = SEMANTIC_MAP_CANVAS.maxY - SEMANTIC_MAP_CANVAS.minY;
  return rows.map((_, index) => [
    clamp(
      SEMANTIC_MAP_CANVAS.minX + ((xs[index] - lowX) / xSpan) * width,
      SEMANTIC_MAP_CANVAS.minX,
      SEMANTIC_MAP_CANVAS.maxX
    ),
    clamp(
      SEMANTIC_MAP_CANVAS.minY + ((ys[index] - lowY) / ySpan) * height,
      SEMANTIC_MAP_CANVAS.minY,
      SEMANTIC_MAP_CANVAS.maxY
    ),
  ]);
}

/**
 * Pulls each neighborhood together and pushes neighborhoods apart in the 2D
 * layout.
 *
 * Neighborhood colour comes from k-means over the full-dimensional embeddings,
 * while position comes from an independent 2D projection. The two do not have to
 * agree, which is why papers could appear inside a neighborhood they were not a
 * member of. Reconciling them here keeps the honest high-dimensional membership
 * while making the picture match the colours.
 */
export function separateClusters(
  coordinates: number[][],
  assignments: number[],
  cohesion = 0.3,
  separation = 0.55
): number[][] {
  if (coordinates.length === 0) return [];
  const ids = [...new Set(assignments)];
  if (ids.length < 2) return coordinates;

  const centroids = new Map<number, [number, number]>();
  ids.forEach((id) => {
    const members = coordinates.filter((_, index) => assignments[index] === id);
    if (members.length === 0) return;
    centroids.set(id, [
      members.reduce((sum, row) => sum + row[0], 0) / members.length,
      members.reduce((sum, row) => sum + row[1], 0) / members.length,
    ]);
  });
  const globalX = coordinates.reduce((sum, row) => sum + row[0], 0) / coordinates.length;
  const globalY = coordinates.reduce((sum, row) => sum + row[1], 0) / coordinates.length;

  const moved = coordinates.map((row, index) => {
    const centroid = centroids.get(assignments[index]);
    if (!centroid) return [row[0], row[1]];
    // Tighten the paper toward its own neighborhood centre...
    const cohesiveX = centroid[0] + (row[0] - centroid[0]) * (1 - cohesion);
    const cohesiveY = centroid[1] + (row[1] - centroid[1]) * (1 - cohesion);
    // ...then move the whole neighborhood away from the map centre.
    return [
      cohesiveX + (centroid[0] - globalX) * separation,
      cohesiveY + (centroid[1] - globalY) * separation,
    ];
  });
  return normalizeCoordinates(moved);
}

export function euclideanDistance(left: number[], right: number[]): number {
  const length = Math.min(left.length, right.length);
  let squaredDistance = 0;
  for (let index = 0; index < length; index += 1) {
    const delta = left[index] - right[index];
    squaredDistance += delta * delta;
  }
  return Math.sqrt(squaredDistance);
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
    const high = new Set(nearestIndices(embeddings, index, count, euclideanDistance));
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

export function projectEmbeddings(
  embeddings: number[][],
  seed = SEMANTIC_MAP_SEED,
  forcePca = false,
  assignments?: number[]
): ProjectionResult {
  if (embeddings.length === 0) {
    return { coordinates: [], algorithm: "single", parameters: { seed }, quality: { neighborhoodPreservation: 1 } };
  }
  if (embeddings.length === 1) {
    return { coordinates: [[500, 400]], algorithm: "single", parameters: { seed }, quality: { neighborhoodPreservation: 1 } };
  }

  if (embeddings.length <= 12 || forcePca) {
    const projected = pcaProjection(embeddings);
    const coordinates = applyClusterSeparation(normalizeCoordinates(projected.rows), assignments);
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
    distanceFn: euclideanDistance,
    random: seededRandom(seed),
  });
  const coordinates = applyClusterSeparation(normalizeCoordinates(umap.fit(embeddings)), assignments);
  return {
    coordinates,
    algorithm: "umap",
    parameters: { seed, components: 2, nNeighbors, minDist },
    quality: { neighborhoodPreservation: neighborhoodPreservation(embeddings, coordinates) },
  };
}

function applyClusterSeparation(coordinates: number[][], assignments?: number[]): number[][] {
  if (!assignments || assignments.length !== coordinates.length) return coordinates;
  return separateClusters(coordinates, assignments);
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
      .map((candidate, target) => ({
        target,
        distance: source === target ? Number.POSITIVE_INFINITY : euclideanDistance(embedding, candidate),
      }))
      .filter((item) => item.target !== source)
      .sort((a, b) => a.distance - b.distance || a.target - b.target)
  );
  const threshold = percentile(
    ranked.flatMap((items) => items.slice(0, neighbors).map((item) => item.distance)),
    0.65
  );
  const edgeMap = new Map<string, SimilarityEdgeIndex>();
  for (let source = 0; source < ranked.length; source += 1) {
    for (let rank = 0; rank < Math.min(neighbors, ranked[source].length); rank += 1) {
      const candidate = ranked[source][rank];
      const reciprocal = ranked[candidate.target].slice(0, neighbors).some((item) => item.target === source);
      if (!reciprocal && candidate.distance > threshold * 0.75) continue;
      if (candidate.distance > threshold) continue;
      const left = Math.min(source, candidate.target);
      const right = Math.max(source, candidate.target);
      const key = `${left}:${right}`;
      const existing = edgeMap.get(key);
      const value = {
        source: left,
        target: right,
        distance: candidate.distance,
        similarity: 1 / (1 + candidate.distance),
        rank: rank + 1,
      };
      if (!existing || value.distance < existing.distance) edgeMap.set(key, value);
    }
  }
  return [...edgeMap.values()].sort((a, b) => a.distance - b.distance || a.source - b.source || a.target - b.target);
}

/**
 * Adds the fewest edges needed so each neighborhood is a connected subgraph.
 *
 * Neighborhood colour and relationship lines are computed separately: colour is
 * k-means membership, lines are mutual nearest-neighbour links above a distance
 * threshold. Two papers could therefore share a colour with no line between
 * them, which readers reasonably read as a contradiction. Linking each
 * neighborhood with its own minimum spanning tree removes that contradiction
 * without inventing links between unrelated neighborhoods.
 */
export function connectClusters(
  embeddings: number[][],
  edges: SimilarityEdgeIndex[],
  assignments: number[]
): SimilarityEdgeIndex[] {
  if (embeddings.length < 2) return edges;
  const result = [...edges];
  const key = (left: number, right: number) => `${Math.min(left, right)}:${Math.max(left, right)}`;
  const present = new Set(result.map((edge) => key(edge.source, edge.target)));

  for (const id of [...new Set(assignments)]) {
    const members = assignments.map((value, index) => (value === id ? index : -1)).filter((index) => index >= 0);
    if (members.length < 2) continue;
    // Union-find over the edges this neighborhood already has.
    const parent = new Map<number, number>(members.map((index) => [index, index]));
    const find = (node: number): number => {
      let current = node;
      while (parent.get(current) !== current) {
        const next = parent.get(current)!;
        parent.set(current, parent.get(next)!);
        current = next;
      }
      return current;
    };
    const union = (left: number, right: number): boolean => {
      const a = find(left);
      const b = find(right);
      if (a === b) return false;
      parent.set(a, b);
      return true;
    };
    result.forEach((edge) => {
      if (parent.has(edge.source) && parent.has(edge.target)) union(edge.source, edge.target);
    });
    // Candidate links inside the neighborhood, shortest first.
    const candidates: Array<{ source: number; target: number; distance: number }> = [];
    for (let left = 0; left < members.length; left += 1) {
      for (let right = left + 1; right < members.length; right += 1) {
        candidates.push({
          source: members[left],
          target: members[right],
          distance: euclideanDistance(embeddings[members[left]], embeddings[members[right]]),
        });
      }
    }
    candidates.sort((a, b) => a.distance - b.distance || a.source - b.source || a.target - b.target);
    for (const candidate of candidates) {
      if (!union(candidate.source, candidate.target)) continue;
      const edgeKey = key(candidate.source, candidate.target);
      if (present.has(edgeKey)) continue;
      present.add(edgeKey);
      result.push({
        source: Math.min(candidate.source, candidate.target),
        target: Math.max(candidate.source, candidate.target),
        distance: candidate.distance,
        similarity: 1 / (1 + candidate.distance),
        rank: CLUSTER_BRIDGE_EDGE_RANK,
      });
    }
  }
  return result.sort((a, b) => a.distance - b.distance || a.source - b.source || a.target - b.target);
}

interface ClusterResult { assignments: number[]; score: number }

function deterministicKMeans(embeddings: number[][], k: number): number[] {
  const centers: number[][] = [embeddings[0]];
  while (centers.length < k) {
    let bestIndex = 0;
    let bestDistance = -1;
    embeddings.forEach((embedding, index) => {
      const distance = Math.min(...centers.map((center) => euclideanDistance(embedding, center)));
      if (distance > bestDistance) { bestDistance = distance; bestIndex = index; }
    });
    centers.push(embeddings[bestIndex]);
  }
  let assignments = embeddings.map(() => 0);
  for (let iteration = 0; iteration < 40; iteration += 1) {
    const next = embeddings.map((embedding) => {
      let best = 0;
      for (let cluster = 1; cluster < centers.length; cluster += 1) {
        if (euclideanDistance(embedding, centers[cluster]) < euclideanDistance(embedding, centers[best])) best = cluster;
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
    // Rousseeuw defines the silhouette of a point alone in its cluster as 0.
    // Treating its mean intra-cluster distance as 0 instead scores it 1.0 - the
    // maximum - so a split that isolates a paper would look like the best split
    // available. enforceMinimumClusterSize means singletons do not currently
    // reach here, but a metric that rewards them is a trap for whoever relaxes
    // that.
    if (same.length === 0) return;
    const a = same.reduce((sum, row) => sum + euclideanDistance(embedding, row), 0) / same.length;
    const alternatives = clusters.filter((cluster) => cluster !== own).map((cluster) => {
      const rows = embeddings.filter((_, candidate) => assignments[candidate] === cluster);
      return rows.reduce((sum, row) => sum + euclideanDistance(embedding, row), 0) / rows.length;
    });
    const b = Math.min(...alternatives);
    total += Math.max(a, b) === 0 ? 0 : (b - a) / Math.max(a, b);
  });
  return total / embeddings.length;
}

/** Smallest useful neighborhood, as a share of the repository. */
export function minimumClusterSize(paperCount: number): number {
  return Math.max(2, Math.round(paperCount * 0.05));
}

function centroidOf(embeddings: number[][], members: number[]): number[] {
  const dimensions = embeddings[0].length;
  const centre = new Array(dimensions).fill(0);
  members.forEach((index) => {
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      centre[dimension] += embeddings[index][dimension];
    }
  });
  return centre.map((value) => value / members.length);
}

/**
 * Folds undersized neighborhoods into their nearest surviving neighborhood.
 *
 * Seeding picks the point farthest from the existing centres, which reliably
 * promotes an outlier into a neighborhood of its own. A repository split 37 to 1
 * is technically a partition but tells a reader nothing, so groups below the
 * minimum size are merged into whichever surviving group they sit closest to.
 */
export function enforceMinimumClusterSize(
  embeddings: number[][],
  assignments: number[],
  minSize: number
): number[] {
  const next = [...assignments];
  for (let guard = 0; guard < 16; guard += 1) {
    const members = new Map<number, number[]>();
    next.forEach((cluster, index) => {
      if (!members.has(cluster)) members.set(cluster, []);
      members.get(cluster)!.push(index);
    });
    if (members.size <= 1) break;
    let smallest: [number, number[]] | null = null;
    members.forEach((rows, cluster) => {
      if (rows.length >= minSize) return;
      if (!smallest || rows.length < smallest[1].length || (rows.length === smallest[1].length && cluster < smallest[0])) {
        smallest = [cluster, rows];
      }
    });
    if (!smallest) break;
    const [smallCluster, smallRows] = smallest as [number, number[]];
    const centres = [...members.entries()]
      .filter(([cluster]) => cluster !== smallCluster)
      .map(([cluster, rows]) => ({ cluster, centre: centroidOf(embeddings, rows) }));
    if (centres.length === 0) break;
    const smallCentre = centroidOf(embeddings, smallRows);
    let target = centres[0];
    centres.forEach((candidate) => {
      if (
        euclideanDistance(smallCentre, candidate.centre) <
        euclideanDistance(smallCentre, target.centre)
      ) {
        target = candidate;
      }
    });
    smallRows.forEach((index) => {
      next[index] = target.cluster;
    });
  }
  // Renumber so neighborhood ids stay contiguous from zero.
  const order = [...new Set(next)].sort((a, b) => a - b);
  const remap = new Map(order.map((cluster, position) => [cluster, position]));
  return next.map((cluster) => remap.get(cluster)!);
}

export function clusterEmbeddings(embeddings: number[][]): ClusterResult {
  if (embeddings.length < 5) return { assignments: embeddings.map(() => 0), score: 0 };
  const maxK = Math.min(7, Math.max(2, Math.round(Math.sqrt(embeddings.length))));
  const minSize = minimumClusterSize(embeddings.length);
  let best: ClusterResult = { assignments: embeddings.map(() => 0), score: 0 };
  for (let k = 2; k <= maxK; k += 1) {
    const assignments = enforceMinimumClusterSize(
      embeddings,
      deterministicKMeans(embeddings, k),
      minSize
    );
    if (new Set(assignments).size < 2) continue;
    const score = silhouetteScore(embeddings, assignments);
    if (score > best.score) best = { assignments, score };
  }
  return best.score >= 0.08 ? best : { assignments: embeddings.map(() => 0), score: best.score };
}
