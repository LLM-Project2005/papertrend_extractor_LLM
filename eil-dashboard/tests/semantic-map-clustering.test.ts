import assert from "node:assert/strict";
import test from "node:test";
import {
  CLUSTER_BRIDGE_EDGE_RANK,
  SEMANTIC_MAP_CANVAS,
  clusterEmbeddings,
  connectClusters,
  buildSimilarityEdges,
  euclideanDistance,
  projectEmbeddings,
  separateClusters,
} from "../src/lib/semantic-map-math";
import { semanticMapMethodology } from "../src/lib/semantic-map-presentation";

/** Three well-separated groups in a high-dimensional space. */
function groupedEmbeddings(dimensions = 24, perGroup = 6): { vectors: number[][]; truth: number[] } {
  const vectors: number[][] = [];
  const truth: number[] = [];
  const anchors = [0, 1, 2];
  anchors.forEach((group) => {
    for (let member = 0; member < perGroup; member += 1) {
      const row = new Array(dimensions).fill(0).map((_, index) => {
        const base = index % 3 === group ? 1 : 0;
        // Deterministic jitter keeps the fixture reproducible.
        return base + ((member * 7 + index * 13) % 5) / 100;
      });
      vectors.push(row);
      truth.push(group);
    }
  });
  return { vectors, truth };
}

function centroid(rows: number[][]): [number, number] {
  return [
    rows.reduce((sum, row) => sum + row[0], 0) / rows.length,
    rows.reduce((sum, row) => sum + row[1], 0) / rows.length,
  ];
}

/**
 * Ratio of the distance between neighborhood centres to the spread inside a
 * neighborhood. Higher means the neighborhoods read as visually distinct.
 */
function separationRatio(coordinates: number[][], assignments: number[]): number {
  const ids = [...new Set(assignments)];
  if (ids.length < 2) return 0;
  const centres = ids.map((id) => centroid(coordinates.filter((_, index) => assignments[index] === id)));
  let betweenTotal = 0;
  let betweenCount = 0;
  for (let left = 0; left < centres.length; left += 1) {
    for (let right = left + 1; right < centres.length; right += 1) {
      betweenTotal += euclideanDistance(centres[left], centres[right]);
      betweenCount += 1;
    }
  }
  const within =
    ids.reduce((sum, id, position) => {
      const members = coordinates.filter((_, index) => assignments[index] === id);
      const spread = members.reduce((total, row) => total + euclideanDistance(row, centres[position]), 0) / members.length;
      return sum + spread;
    }, 0) / ids.length;
  return within === 0 ? Number.POSITIVE_INFINITY : betweenTotal / betweenCount / within;
}

/** How many papers sit closer to another neighborhood's centre than their own. */
function misplacedPapers(coordinates: number[][], assignments: number[]): number {
  const ids = [...new Set(assignments)];
  const centres = new Map(
    ids.map((id) => [id, centroid(coordinates.filter((_, index) => assignments[index] === id))])
  );
  return coordinates.filter((row, index) => {
    const own = euclideanDistance(row, centres.get(assignments[index])!);
    return ids.some((id) => id !== assignments[index] && euclideanDistance(row, centres.get(id)!) < own);
  }).length;
}

test("clustering recovers genuinely separate groups", () => {
  const { vectors, truth } = groupedEmbeddings();
  const clustering = clusterEmbeddings(vectors);
  assert.equal(clustering.assignments.length, vectors.length);
  // Papers sharing a true group must share a predicted neighborhood.
  const byTruth = new Map<number, Set<number>>();
  truth.forEach((group, index) => {
    if (!byTruth.has(group)) byTruth.set(group, new Set());
    byTruth.get(group)!.add(clustering.assignments[index]);
  });
  byTruth.forEach((predicted, group) => {
    assert.equal(predicted.size, 1, `group ${group} was split across neighborhoods`);
  });
});

test("separating neighborhoods spreads them apart without losing membership", () => {
  const { vectors } = groupedEmbeddings();
  const assignments = clusterEmbeddings(vectors).assignments;
  const before = projectEmbeddings(vectors, 42, true);
  const after = separateClusters(before.coordinates, assignments);

  const beforeRatio = separationRatio(before.coordinates, assignments);
  const afterRatio = separationRatio(after, assignments);
  assert.ok(
    afterRatio > beforeRatio,
    `separation should improve: before ${beforeRatio.toFixed(2)}, after ${afterRatio.toFixed(2)}`
  );
  assert.equal(after.length, before.coordinates.length);
});

test("no paper is drawn inside another neighborhood after separation", () => {
  const { vectors } = groupedEmbeddings();
  const assignments = clusterEmbeddings(vectors).assignments;
  const projected = projectEmbeddings(vectors, 42, true, assignments);
  assert.equal(
    misplacedPapers(projected.coordinates, assignments),
    0,
    "every paper should sit nearest to its own neighborhood centre"
  );
});

test("separated coordinates stay inside the canvas", () => {
  const { vectors } = groupedEmbeddings();
  const assignments = clusterEmbeddings(vectors).assignments;
  const projected = projectEmbeddings(vectors, 42, true, assignments);
  for (const [x, y] of projected.coordinates) {
    assert.ok(x >= SEMANTIC_MAP_CANVAS.minX && x <= SEMANTIC_MAP_CANVAS.maxX, `x out of range: ${x}`);
    assert.ok(y >= SEMANTIC_MAP_CANVAS.minY && y <= SEMANTIC_MAP_CANVAS.maxY, `y out of range: ${y}`);
  }
});

test("separation is deterministic", () => {
  const { vectors } = groupedEmbeddings();
  const assignments = clusterEmbeddings(vectors).assignments;
  const first = projectEmbeddings(vectors, 42, true, assignments);
  const second = projectEmbeddings(vectors, 42, true, assignments);
  assert.deepEqual(first.coordinates, second.coordinates);
});

test("a single neighborhood is left untouched", () => {
  const coordinates = [[100, 100], [200, 200], [300, 300]];
  assert.deepEqual(separateClusters(coordinates, [0, 0, 0]), coordinates);
});

test("one far outlier no longer squashes the rest of the map", () => {
  // Eleven papers close together plus one extreme outlier.
  const rows: number[][] = [];
  for (let index = 0; index < 11; index += 1) rows.push([index, index]);
  rows.push([100000, 100000]);
  const spread = projectEmbeddings(rows.map((row) => [...row, 0]), 42, true);
  const bulk = spread.coordinates.slice(0, 11);
  const xs = bulk.map((row) => row[0]);
  const width = Math.max(...xs) - Math.min(...xs);
  // Under plain min-max scaling the eleven clustered papers collapsed into a
  // sliver. They should now occupy a usable share of the canvas.
  assert.ok(width > 200, `bulk papers should stay readable, width was ${width.toFixed(1)}`);
});

test("every neighborhood is drawn as a connected group", () => {
  const { vectors } = groupedEmbeddings();
  const assignments = clusterEmbeddings(vectors).assignments;
  const edges = connectClusters(vectors, buildSimilarityEdges(vectors), assignments);

  for (const id of [...new Set(assignments)]) {
    const members = assignments.map((value, index) => (value === id ? index : -1)).filter((index) => index >= 0);
    if (members.length < 2) continue;
    const adjacency = new Map<number, number[]>(members.map((index) => [index, []]));
    edges.forEach((edge) => {
      if (adjacency.has(edge.source) && adjacency.has(edge.target)) {
        adjacency.get(edge.source)!.push(edge.target);
        adjacency.get(edge.target)!.push(edge.source);
      }
    });
    const seen = new Set<number>([members[0]]);
    const queue = [members[0]];
    while (queue.length > 0) {
      const node = queue.shift()!;
      for (const next of adjacency.get(node) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    assert.equal(
      seen.size,
      members.length,
      `neighborhood ${id} is drawn with the same colour but is not fully connected`
    );
  }
});

test("connecting neighborhoods never links papers across neighborhoods", () => {
  const { vectors } = groupedEmbeddings();
  const assignments = clusterEmbeddings(vectors).assignments;
  const before = buildSimilarityEdges(vectors);
  const after = connectClusters(vectors, before, assignments);
  const added = after.filter(
    (edge) => !before.some((item) => item.source === edge.source && item.target === edge.target)
  );
  added.forEach((edge) => {
    assert.equal(
      assignments[edge.source],
      assignments[edge.target],
      "added links must stay inside one neighborhood"
    );
  });
});

test("connecting neighborhoods preserves the original nearest-neighbour edges", () => {
  const { vectors } = groupedEmbeddings();
  const assignments = clusterEmbeddings(vectors).assignments;
  const before = buildSimilarityEdges(vectors);
  const after = connectClusters(vectors, before, assignments);
  before.forEach((edge) => {
    assert.ok(
      after.some((item) => item.source === edge.source && item.target === edge.target),
      "existing relationship lines must be kept"
    );
  });
});

test("added neighborhood links are marked so they can be styled apart", () => {
  const { vectors } = groupedEmbeddings();
  const assignments = clusterEmbeddings(vectors).assignments;
  const before = buildSimilarityEdges(vectors);
  const after = connectClusters(vectors, before, assignments);
  const added = after.filter(
    (edge) => !before.some((item) => item.source === edge.source && item.target === edge.target)
  );
  added.forEach((edge) =>
    assert.equal(edge.rank, CLUSTER_BRIDGE_EDGE_RANK, "neighborhood links use the bridge rank")
  );
  // The stored schema enforces CHECK (edge_rank > 0).
  added.forEach((edge) => assert.ok(edge.rank > 0, "bridge rank must satisfy the database constraint"));
});

test("the methodology explainer answers what computes a neighborhood", () => {
  const text = semanticMapMethodology(
    { clusterCount: 4, clusterSilhouette: 0.31, clusterBridgeEdgeCount: 7, neighborhoodPreservation: 0.65 },
    "umap"
  );
  assert.match(text.clustering, /k-means/i);
  assert.match(text.clustering, /embedding/i);
  assert.match(text.clustering, /silhouette/i);
  assert.match(text.clustering, /4/);
  assert.match(text.position, /UMAP/);
  assert.match(text.position, /65%/);
});

test("the explainer distinguishes colour from lines", () => {
  const text = semanticMapMethodology({ clusterBridgeEdgeCount: 2 }, "pca");
  assert.match(text.colourVersusLines, /share a colour without a line/i);
  assert.match(text.lines, /not (?:be )?citations/i);
  assert.match(text.position, /PCA/);
});

test("the explainer never claims causation or academic agreement", () => {
  const text = semanticMapMethodology({}, null);
  assert.match(text.caution, /not evidence of citation/i);
  assert.match(text.caution, /agreement/i);
  // Degrades cleanly when quality metrics are absent.
  assert.doesNotMatch(text.clustering, /currently 0/);
  assert.doesNotMatch(text.position, /About 0%/);
});
