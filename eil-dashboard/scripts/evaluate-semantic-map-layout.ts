/**
 * Offline layout evaluation for the semantic map.
 *
 * Measures, on synthetic corpora with known neighborhood structure, whether the
 * rendered map separates neighborhoods the way a reader expects. Run with:
 *   npx tsx scripts/evaluate-semantic-map-layout.ts
 */
import {
  buildSimilarityEdges,
  clusterEmbeddings,
  connectClusters,
  euclideanDistance,
  neighborhoodPreservation,
  projectEmbeddings,
} from "../src/lib/semantic-map-math";

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Synthetic corpus: `groups` themes, each a Gaussian blob, plus noise papers. */
function corpus(groups: number, perGroup: number, dimensions: number, noise: number, seed: number) {
  const random = seeded(seed);
  const centres = Array.from({ length: groups }, () =>
    Array.from({ length: dimensions }, () => random() * 2 - 1)
  );
  const vectors: number[][] = [];
  const truth: number[] = [];
  centres.forEach((centre, group) => {
    for (let member = 0; member < perGroup; member += 1) {
      vectors.push(centre.map((value) => value + (random() * 2 - 1) * noise));
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

function metrics(coordinates: number[][], assignments: number[]) {
  const ids = [...new Set(assignments)];
  const centres = new Map(
    ids.map((id) => [id, centroid(coordinates.filter((_, index) => assignments[index] === id))])
  );
  const within =
    ids.reduce((sum, id) => {
      const members = coordinates.filter((_, index) => assignments[index] === id);
      return sum + members.reduce((total, row) => total + euclideanDistance(row, centres.get(id)!), 0) / members.length;
    }, 0) / ids.length;
  let between = 0;
  let pairs = 0;
  for (let left = 0; left < ids.length; left += 1) {
    for (let right = left + 1; right < ids.length; right += 1) {
      between += euclideanDistance(centres.get(ids[left])!, centres.get(ids[right])!);
      pairs += 1;
    }
  }
  const misplaced = coordinates.filter((row, index) => {
    const own = euclideanDistance(row, centres.get(assignments[index])!);
    return ids.some((id) => id !== assignments[index] && euclideanDistance(row, centres.get(id)!) < own);
  }).length;
  const xs = coordinates.map((row) => row[0]);
  const ys = coordinates.map((row) => row[1]);
  return {
    separationRatio: pairs === 0 || within === 0 ? 0 : between / pairs / within,
    misplaced,
    misplacedPct: (misplaced / coordinates.length) * 100,
    usedWidth: Math.max(...xs) - Math.min(...xs),
    usedHeight: Math.max(...ys) - Math.min(...ys),
  };
}

const scenarios = [
  { name: "3 themes / 30 papers / tight", groups: 3, perGroup: 10, noise: 0.25 },
  { name: "4 themes / 48 papers / overlapping", groups: 4, perGroup: 12, noise: 0.55 },
  { name: "5 themes / 100 papers / noisy", groups: 5, perGroup: 20, noise: 0.7 },
  { name: "2 themes / 14 papers / small (PCA path)", groups: 2, perGroup: 7, noise: 0.3 },
];

console.log("Semantic map layout evaluation\n");
let improved = 0;
for (const scenario of scenarios) {
  const { vectors } = corpus(scenario.groups, scenario.perGroup, 48, scenario.noise, 20260920);
  const assignments = clusterEmbeddings(vectors).assignments;

  const before = projectEmbeddings(vectors, 42);
  const after = projectEmbeddings(vectors, 42, false, assignments);

  const beforeMetrics = metrics(before.coordinates, assignments);
  const afterMetrics = metrics(after.coordinates, assignments);

  const nearest = buildSimilarityEdges(vectors);
  const connected = connectClusters(vectors, nearest, assignments);
  const disconnectedBefore = countDisconnectedNeighborhoods(nearest, assignments);
  const disconnectedAfter = countDisconnectedNeighborhoods(connected, assignments);

  if (afterMetrics.separationRatio > beforeMetrics.separationRatio) improved += 1;

  console.log(`## ${scenario.name}`);
  console.log(`   algorithm                ${after.algorithm}`);
  console.log(`   neighborhoods found      ${new Set(assignments).size}`);
  console.log(
    `   separation ratio         ${beforeMetrics.separationRatio.toFixed(2)} -> ${afterMetrics.separationRatio.toFixed(2)}  (higher is clearer)`
  );
  console.log(
    `   papers inside wrong group ${beforeMetrics.misplaced} (${beforeMetrics.misplacedPct.toFixed(1)}%) -> ${afterMetrics.misplaced} (${afterMetrics.misplacedPct.toFixed(1)}%)`
  );
  console.log(
    `   canvas used              ${beforeMetrics.usedWidth.toFixed(0)}x${beforeMetrics.usedHeight.toFixed(0)} -> ${afterMetrics.usedWidth.toFixed(0)}x${afterMetrics.usedHeight.toFixed(0)}`
  );
  console.log(
    `   neighborhoods with no internal line ${disconnectedBefore} -> ${disconnectedAfter}`
  );
  console.log(
    `   neighbourhood preservation ${(after.quality.neighborhoodPreservation ?? 0).toFixed(3)}`
  );
  console.log(`   relationship lines       ${nearest.length} -> ${connected.length}\n`);
}

console.log(`Improved separation in ${improved}/${scenarios.length} scenarios.`);

function countDisconnectedNeighborhoods(
  edges: Array<{ source: number; target: number }>,
  assignments: number[]
): number {
  let broken = 0;
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
    if (seen.size !== members.length) broken += 1;
  }
  return broken;
}
