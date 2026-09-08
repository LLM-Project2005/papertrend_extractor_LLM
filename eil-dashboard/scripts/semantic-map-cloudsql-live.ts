import { randomUUID } from "node:crypto";
import { parseIntoClientConfig } from "pg-connection-string";
import { withCloudSqlOwnerTransaction } from "../src/lib/cloudsql/client";
import {
  createSemanticMapJob,
  getSemanticMap,
  loadSemanticMapCoverage,
  loadSemanticPaperDocuments,
  semanticSourceHash,
} from "../src/lib/semantic-map-repository";
import { processSemanticMapJob } from "../src/lib/semantic-map-service";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function useLocalProxyDatabaseUrl(): void {
  const source = process.env.DATABASE_URL?.trim();
  if (!source) throw new Error("DATABASE_URL is required.");
  const parsed = parseIntoClientConfig(source);
  const user = encodeURIComponent(parsed.user ?? "");
  const password = encodeURIComponent(String(parsed.password ?? ""));
  const database = encodeURIComponent(parsed.database ?? "postgres");
  const host = process.env.CLOUDSQL_PROXY_HOST ?? "127.0.0.1";
  const port = process.env.CLOUDSQL_PROXY_PORT ?? "5432";
  process.env.DATABASE_URL = `postgresql://${user}:${password}@${host}:${port}/${database}`;
}

async function chooseProject(ownerUserId: string, requestedProjectId: string | null): Promise<string> {
  if (requestedProjectId) return requestedProjectId;
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query<{ id: string }>(
      `SELECT wp.id::text
       FROM public.workspace_projects wp
       LEFT JOIN public.research_folders rf ON rf.project_id=wp.id AND rf.owner_user_id=$1
       LEFT JOIN public.ingestion_runs ir ON ir.folder_id=rf.id AND ir.owner_user_id=$1
         AND ir.status='succeeded' AND ir.trashed_at IS NULL
       WHERE wp.owner_user_id=$1
       GROUP BY wp.id
       ORDER BY count(ir.id) DESC, wp.created_at ASC
       LIMIT 1`,
      [ownerUserId]
    );
    if (!result.rows[0]) throw new Error("The owner has no repository to test.");
    return result.rows[0].id;
  });
}

async function main() {
  useLocalProxyDatabaseUrl();
  const ownerUserId = argument("--owner-user-id");
  if (!ownerUserId) throw new Error("--owner-user-id is required.");
  const projectId = await chooseProject(ownerUserId, argument("--project-id"));
  if (process.argv.includes("--coverage")) {
    const [documents, map, coverage] = await Promise.all([
      loadSemanticPaperDocuments(ownerUserId, projectId),
      getSemanticMap(ownerUserId, projectId),
      loadSemanticMapCoverage(ownerUserId, projectId),
    ]);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      projectId,
      mappedPapers: map?.points.length ?? 0,
      mapStale: map?.stale ?? false,
      eligibleDocuments: documents.length,
      coverage,
    }, null, 2)}\n`);
    return;
  }
  if (!process.argv.includes("--apply")) {
    throw new Error("Pass --coverage for a read-only report or --apply to generate a map revision.");
  }
  const documents = await loadSemanticPaperDocuments(ownerUserId, projectId);
  if (documents.length === 0) throw new Error("The selected repository has no eligible analyzed papers.");
  const sourceHash = semanticSourceHash(documents);
  const mapId = await createSemanticMapJob(ownerUserId, projectId, sourceHash, documents.length);
  await processSemanticMapJob(ownerUserId, mapId);
  const map = await getSemanticMap(ownerUserId, projectId);
  if (!map || map.status !== "succeeded") throw new Error("The generated map was not published.");
  const paperIds = map.points.map((point) => point.paperId);
  if (map.points.length !== documents.length || new Set(paperIds).size !== documents.length) {
    throw new Error("Eligible papers did not map exactly once.");
  }
  const serialized = JSON.stringify(map);
  if (serialized.includes("embedding") || serialized.includes("documentText")) {
    throw new Error("The public map contract exposed private semantic input.");
  }
  let crossOwnerDenied = false;
  try {
    await getSemanticMap(randomUUID(), projectId);
  } catch (error) {
    crossOwnerDenied = error instanceof Error && error.message === "Repository not found.";
  }
  if (!crossOwnerDenied) throw new Error("Cross-owner repository access was not denied.");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    projectId,
    mapId: map.mapId,
    eligiblePapers: documents.length,
    mappedPapers: map.points.length,
    edges: map.edges.length,
    clusters: map.clusters.length,
    projection: map.projection.algorithm,
    stale: map.stale,
    crossOwnerDenied,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
