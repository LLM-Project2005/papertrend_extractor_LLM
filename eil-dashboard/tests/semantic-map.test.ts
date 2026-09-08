import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSimilarityEdges, clusterEmbeddings, cosineSimilarity, projectEmbeddings } from "../src/lib/semantic-map-math";
import { semanticSourceHash } from "../src/lib/semantic-map-repository";
import type { SemanticPaperDocument } from "../src/types/semantic-map";

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

test("similarity edges are canonical and unique", () => {
  const edges = buildSimilarityEdges([[1, 0], [0.99, 0.01], [0, 1], [0.01, 0.99]]);
  const keys = edges.map((edge) => `${edge.source}:${edge.target}`);
  assert.equal(new Set(keys).size, keys.length);
  assert.ok(edges.every((edge) => edge.source < edge.target));
});

test("clustering assigns every paper", () => {
  const result = clusterEmbeddings([[1, 0], [0.98, 0.02], [0.95, 0.05], [0, 1], [0.02, 0.98], [0.05, 0.95]]);
  assert.equal(result.assignments.length, 6);
  assert.ok(result.assignments.every(Number.isInteger));
});

test("source hash is order independent and changes with repository state", () => {
  const first = semanticSourceHash([paper(1), paper(2)]);
  assert.equal(first, semanticSourceHash([paper(2), paper(1)]));
  assert.notEqual(first, semanticSourceHash([{ ...paper(1), folderId: "00000000-0000-4000-8000-000000000099" }, paper(2)]));
  assert.notEqual(first, semanticSourceHash([{ ...paper(1), folderName: "Renamed folder" }, paper(2)]));
});

test("semantic-map API derives ownership only from verified authentication", () => {
  const route = readFileSync(join(process.cwd(), "src/app/api/workspace/semantic-map/route.ts"), "utf8");
  const repository = readFileSync(join(process.cwd(), "src/lib/semantic-map-repository.ts"), "utf8");
  assert.match(route, /getAuthenticatedUserFromRequest/);
  assert.match(route, /user\.id/);
  assert.doesNotMatch(route, /ownerUserId:\s*parsed\.data/);
  assert.match(repository, /p\.owner_user_id=\$1/);
  assert.match(repository, /workspace_projects WHERE id=\$1 AND owner_user_id=\$2/);
});

test("semantic-map browser contract never exposes embeddings or document text", () => {
  const types = readFileSync(join(process.cwd(), "src/types/semantic-map.ts"), "utf8");
  const publicContract = types.slice(types.indexOf("export interface RepositorySemanticMap"), types.indexOf("export interface SemanticPaperDocument"));
  assert.doesNotMatch(publicContract, /embedding|documentText/);
});
