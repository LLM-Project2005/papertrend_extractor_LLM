import { loadRepositoryContext } from "../src/lib/repository-chat";
import { syncRepositoryMemory } from "../src/lib/repository-memory";
import { withCloudSqlOwnerTransaction } from "../src/lib/cloudsql/client";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? "" : "";
}

async function main() {
  const ownerUserId = argument("--owner-user-id");
  const projectId = argument("--project-id");
  const folderId = argument("--folder-id") || null;
  if (!ownerUserId) {
    throw new Error("Usage: tsx scripts/backfill-repository-memory.ts --owner-user-id UUID [--project-id UUID] [--folder-id UUID]");
  }
  const projectIds = projectId ? [projectId] : await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query<{ id: string }>(
      `SELECT id::text FROM workspace_projects WHERE owner_user_id=$1 ORDER BY created_at`, [ownerUserId]
    );
    return result.rows.map((row) => row.id);
  });
  const results = [];
  for (const scopedProjectId of projectIds) {
    const context = await loadRepositoryContext({ ownerUserId, projectId: scopedProjectId, folderId, prompt: "Backfill repository retrieval memory" });
    const result = await syncRepositoryMemory({ ownerUserId, projectId: scopedProjectId, folderId }, context.papers);
    results.push({ projectId: scopedProjectId, ...result, versionHash: context.versionHash });
  }
  console.log(JSON.stringify({ ok: true, projects: results }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
