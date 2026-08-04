import { withCloudSqlOwnerTransaction } from "../src/lib/cloudsql/client";

async function main() {
  const index = process.argv.indexOf("--owner-user-id");
  const ownerUserId = index >= 0 ? process.argv[index + 1] ?? "" : "";
  if (!ownerUserId) throw new Error("--owner-user-id is required");
  const report = await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query<{
      documents: string; chunks: string; embedded_chunks: string; projects: string; papers: string;
    }>(`SELECT
      (SELECT count(*) FROM paper_retrieval_documents WHERE owner_user_id=$1)::text AS documents,
      (SELECT count(*) FROM paper_retrieval_chunks WHERE owner_user_id=$1)::text AS chunks,
      (SELECT count(*) FROM paper_retrieval_chunks WHERE owner_user_id=$1 AND embedding IS NOT NULL)::text AS embedded_chunks,
      (SELECT count(DISTINCT project_id) FROM paper_retrieval_documents WHERE owner_user_id=$1)::text AS projects,
      (SELECT count(DISTINCT paper_id) FROM paper_retrieval_documents WHERE owner_user_id=$1)::text AS papers`, [ownerUserId]);
    return result.rows[0];
  });
  console.log(JSON.stringify({ ok: true, ...report }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
