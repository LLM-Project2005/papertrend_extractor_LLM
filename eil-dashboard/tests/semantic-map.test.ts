import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSimilarityEdges, clusterEmbeddings, cosineSimilarity, euclideanDistance, projectEmbeddings } from "../src/lib/semantic-map-math";
import { buildSemanticSelectionInsight, selectReadableOverviewEdges } from "../src/lib/semantic-map-presentation";
import { semanticSourceHash } from "../src/lib/semantic-map-repository";
import type { SemanticMapEdge, SemanticMapPoint, SemanticPaperDocument } from "../src/types/semantic-map";

function vectors(count: number, dimensions = 16): number[][] {
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: dimensions }, (_, column) => Math.sin((row + 1) * (column + 3)) + (row % 3) * 0.2)
  );
}

function paper(id: number): SemanticPaperDocument {
  return {
    paperId: String(id), runId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    projectId: "00000000-0000-4000-8000-000000000001", folderId: null, folderName: null,
    title: `Paper ${id}`, year: "2026", abstract: "Abstract", objectives: [], methods: "survey",
    results: "Results", conclusion: "Conclusion", categories: ["Assessment"], topics: ["Learning"],
    keywords: ["feedback"], track: "EL", documentText: `# Paper ${id}`, contentHash: String(id).padStart(64, "0"),
  };
}

test("cosine similarity handles identical and opposite vectors", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [-1, 0]), -1);
});

test("euclidean distance is measured in the original vector space", () => {
  assert.equal(euclideanDistance([0, 0], [3, 4]), 5);
  assert.equal(euclideanDistance([1, 2, 3], [1, 2, 3]), 0);
});

for (const count of [1, 4, 5, 12, 13, 50]) {
  test(`projection is deterministic and complete for ${count} papers`, () => {
    const first = projectEmbeddings(vectors(count));
    const second = projectEmbeddings(vectors(count));
    assert.equal(first.coordinates.length, count);
    assert.deepEqual(first.coordinates, second.coordinates);
    assert.equal(first.algorithm, count === 1 ? "single" : count <= 12 ? "pca" : "umap");
    for (const coordinate of first.coordinates) {
      assert.ok(coordinate.every(Number.isFinite));
      assert.ok(coordinate[0] >= 0 && coordinate[0] <= 1000);
      assert.ok(coordinate[1] >= 0 && coordinate[1] <= 800);
    }
  });
}

test("Euclidean relationship edges are canonical, unique, and nearest-first", () => {
  const edges = buildSimilarityEdges([[1, 0], [0.99, 0.01], [0, 1], [0.01, 0.99]]);
  const keys = edges.map((edge) => `${edge.source}:${edge.target}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(edges.every((edge) => edge.source < edge.target));
  assert.ok(edges.every((edge) => edge.distance >= 0));
  assert.deepEqual(edges.map((edge) => edge.distance), [...edges.map((edge) => edge.distance)].sort((a, b) => a - b));
});

test("clustering assigns every paper", () => {
  const result = clusterEmbeddings([[1, 0], [0.98, 0.02], [0.95, 0.05], [0, 1], [0.02, 0.98], [0.05, 0.95]]);
  assert.equal(result.assignments.length, 6);
  assert.ok(result.assignments.every(Number.isInteger));
});

function mapPoint(paperId: string, x: number, y: number, clusterId = 0, topics: string[] = []): SemanticMapPoint {
  return {
    paperId,
    runId: `00000000-0000-4000-8000-${paperId.padStart(12, "0")}`,
    folderId: null,
    x,
    y,
    clusterId,
    title: `Paper ${paperId}`,
    year: "2026",
    folderName: null,
    categories: ["Assessment"],
    topics,
    keywords: ["feedback"],
    track: "EL",
  };
}

function mapEdge(sourcePaperId: string, targetPaperId: string, distance: number): SemanticMapEdge {
  return {
    sourcePaperId,
    targetPaperId,
    distance,
    similarity: 1 / (1 + distance),
    rank: 1,
    sharedSignals: { categories: ["Assessment"], topics: [], keywords: ["feedback"], methods: ["survey"] },
  };
}

test("readable overview edges remain semantic-first while avoiding visual collisions", () => {
  const points = [
    mapPoint("1", 0, 0),
    mapPoint("2", 100, 100),
    mapPoint("3", 0, 100),
    mapPoint("4", 100, 0),
    mapPoint("5", 50, 50),
  ];
  const edges = [
    mapEdge("1", "2", 0.1),
    mapEdge("3", "4", 0.11),
    mapEdge("1", "3", 0.12),
    mapEdge("2", "4", 0.13),
    mapEdge("4", "5", 0.14),
  ];
  const selected = selectReadableOverviewEdges(edges, points, 3);
  assert.equal(selected.length, 3);
  assert.ok(selected.some((edge) => edge.sourcePaperId === "1" && edge.targetPaperId === "3"));
  assert.ok(selected.some((edge) => edge.sourcePaperId === "4" && edge.targetPaperId === "5"));
  assert.ok(selected.every((edge) => edges.includes(edge)));
});

test("multi-paper insight explains neighborhoods, retained links, and recurring evidence", () => {
  const points = [
    mapPoint("1", 0, 0, 0, ["formative assessment"]),
    mapPoint("2", 100, 100, 0, ["formative assessment"]),
    mapPoint("3", 50, 20, 1, ["learner autonomy"]),
  ];
  const edges = [mapEdge("1", "2", 0.25), mapEdge("2", "3", 0.6)];
  const insight = buildSemanticSelectionInsight({
    points,
    edges,
    clusters: [
      { id: 0, label: "Assessment practices", paperCount: 2, terms: [], source: "deterministic" },
      { id: 1, label: "Learner development", paperCount: 1, terms: [], source: "deterministic" },
    ],
  }, ["1", "2"]);
  assert.ok(insight);
  assert.equal(insight.selectedCount, 2);
  assert.equal(insight.possiblePairs, 1);
  assert.equal(insight.directConnections.length, 1);
  assert.equal(insight.closestConnection?.distance, 0.25);
  assert.deepEqual(insight.neighborhoodLabels, ["Assessment practices"]);
  assert.ok(insight.recurringSignals.includes("formative assessment"));
  assert.match(insight.summary, /Every selected pair is directly connected/);
});

test("multi-paper insight is honest when selected papers have no retained edge", () => {
  const insight = buildSemanticSelectionInsight({
    points: [mapPoint("1", 0, 0, 0), mapPoint("3", 100, 100, 1)],
    edges: [],
    clusters: [
      { id: 0, label: "Assessment", paperCount: 1, terms: [], source: "deterministic" },
      { id: 1, label: "Autonomy", paperCount: 1, terms: [], source: "deterministic" },
    ],
  }, ["1", "3"]);
  assert.ok(insight);
  assert.equal(insight.directConnections.length, 0);
  assert.equal(insight.closestConnection, null);
  assert.match(insight.summary, /not direct neighbors/);
});

test("source hash is order independent, content-sensitive, and folder-agnostic", () => {
  const first = semanticSourceHash([paper(1), paper(2)]);
  assert.equal(first, semanticSourceHash([paper(2), paper(1)]));
  assert.equal(first, semanticSourceHash([{ ...paper(1), folderId: "00000000-0000-4000-8000-000000000099" }, paper(2)]));
  assert.equal(first, semanticSourceHash([{ ...paper(1), folderName: "Renamed folder" }, paper(2)]));
  assert.notEqual(first, semanticSourceHash([{ ...paper(1), contentHash: "f".repeat(64) }, paper(2)]));
});

test("semantic-map API derives ownership only from verified authentication", () => {
  const route = readFileSync(join(process.cwd(), "src/app/api/workspace/semantic-map/route.ts"), "utf8");
  const repository = readFileSync(join(process.cwd(), "src/lib/semantic-map-repository.ts"), "utf8");
  assert.match(route, /getAuthenticatedUserFromRequest/);
  assert.match(route, /user\.id/);
  assert.doesNotMatch(route, /ownerUserId:\s*parsed\.data/);
  assert.match(repository, /p\.owner_user_id=\$1/);
  assert.match(repository, /workspace_projects WHERE id=\$1 AND owner_user_id=\$2/);
  assert.match(route, /loadSemanticMapCoverage\(user\.id, projectId\)/);
  assert.match(route, /eligiblePapers: coverage\.eligiblePapers/);
  assert.match(repository, /ir\.owner_user_id=\$1/);
  assert.match(repository, /missing_analysis/);
});

test("semantic-map browser contract never exposes embeddings or document text", () => {
  const types = readFileSync(join(process.cwd(), "src/types/semantic-map.ts"), "utf8");
  const publicContract = types.slice(types.indexOf("export interface RepositorySemanticMap"), types.indexOf("export interface SemanticPaperDocument"));
  assert.doesNotMatch(publicContract, /embedding|documentText/);
});

test("semantic-map paper filters preserve the canvas and cannot hide every scoped paper", () => {
  const component = readFileSync(
    join(process.cwd(), "src/components/workspace/RepositorySemanticMap.tsx"),
    "utf8"
  );
  assert.match(component, /className="nodrag nopan absolute/);
  assert.match(component, /className="nowheel/);
  assert.match(component, /visiblePoints\.length <= 1/);
  assert.match(component, /Neighborhoods/);
  assert.match(component, /edge\.distance/);
  assert.match(component, /edgeTypes=\{EDGE_TYPES\}/);
  assert.match(component, /Selection relationship/);
  assert.match(component, /onInit=\{fitInitialView\}/);
  assert.match(component, /autoPanOnNodeFocus=\{false\}/);
  assert.match(component, /forceSimulation/);
  assert.match(component, /forceCollide/);
  assert.match(component, /forceManyBody/);
  assert.match(component, /forceCenter/);
  assert.match(component, /nodesDraggable=\{layoutMode === "force"\}/);
  assert.match(component, /Projection/);
  assert.match(component, /Force graph/);
  assert.match(component, /candidateEdges\.map/);
  assert.match(component, /All retained relationships are visible/);
  assert.match(component, /forceNode\.fx = null/);
  assert.match(component, /forceNode\.fy = null/);
  assert.match(component, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(component, /nodesDraggable=\{false\}/);
  assert.doesNotMatch(component, /folderFilter/);
  assert.doesNotMatch(component, /cluster-label/);
  assert.doesNotMatch(component, /elementsSelectable fitView/);
  assert.doesNotMatch(component, /hideAllPapersInScope/);
});

test("semantic map is a dashboard tab and no longer a library view", () => {
  const dashboard = readFileSync(join(process.cwd(), "src/components/DashboardClient.tsx"), "utf8");
  const library = readFileSync(join(process.cwd(), "src/components/admin/AdminImportClient.tsx"), "utf8");
  assert.match(dashboard, /key: "semantic_map", label: "Semantic Map"/);
  assert.match(dashboard, /<RepositorySemanticMapView/);
  assert.doesNotMatch(library, /<RepositorySemanticMapView/);
});
