import assert from "node:assert/strict";
import { loadEnvConfig } from "@next/env";
import { Pool } from "pg";
import { loadDashboardDataServer } from "../src/lib/dashboard-data-server";
import { runRepositoryChat } from "../src/lib/repository-chat";

loadEnvConfig(process.cwd());

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  const ownerUserId = process.env.OWNER_USER_ID;
  assert.ok(databaseUrl, "DATABASE_URL is required.");
  assert.ok(ownerUserId, "OWNER_USER_ID is required.");
  process.env.DATABASE_PROVIDER = "cloud-sql";
  process.env.REPOSITORY_CHAT_DISABLE_LLM = "true";
  process.env.REPOSITORY_CHAT_V2_ENABLED = "true";
  process.env.REPOSITORY_HYBRID_RETRIEVAL_ENABLED = "true";

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  let projectId = "";
  let folderId = "";
  let totalRuns = 0;
  let succeededRuns = 0;
  let failedRuns = 0;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.current_user_id', $1, true)", [ownerUserId]);
    const scope = await client.query<{
      project_id: string;
      folder_id: string;
      total_runs: string;
      succeeded_runs: string;
      failed_runs: string;
    }>(
      `SELECT
         rf.project_id,
         rf.id AS folder_id,
         count(ir.id)::text AS total_runs,
         count(ir.id) FILTER (WHERE ir.status = 'succeeded')::text AS succeeded_runs,
         count(ir.id) FILTER (WHERE ir.status = 'failed')::text AS failed_runs
       FROM public.research_folders rf
       JOIN public.ingestion_runs ir ON ir.folder_id = rf.id AND ir.trashed_at IS NULL
       WHERE rf.owner_user_id = $1
       GROUP BY rf.project_id, rf.id
       ORDER BY count(ir.id) DESC
       LIMIT 1`,
      [ownerUserId]
    );
    assert.ok(scope.rows[0], "The owner has no repository folder to test.");
    projectId = scope.rows[0].project_id;
    folderId = scope.rows[0].folder_id;
    totalRuns = Number.parseInt(scope.rows[0].total_runs, 10);
    succeededRuns = Number.parseInt(scope.rows[0].succeeded_runs, 10);
    failedRuns = Number.parseInt(scope.rows[0].failed_runs, 10);
    await client.query("ROLLBACK");
  } finally {
    client.release();
    await pool.end();
  }

  const common = { ownerUserId, projectId, folderId, selectedRunIds: [] as string[] };
  const dashboard = await loadDashboardDataServer(ownerUserId, [folderId], projectId, "live");
  assert.equal(dashboard.useMock, false, "Dashboard unexpectedly fell back to mock data.");
  assert.ok(dashboard.trends.length > 0, "Dashboard returned no live trend rows.");
  const statistics = await runRepositoryChat({
    ...common,
    prompt: "How many papers and files are in the attached repository?",
  });
  assert.equal(statistics.handled, true);
  assert.equal(statistics.plan.intent, "repository_statistics");
  assert.equal(statistics.diagnostics.paperCount, succeededRuns);
  assert.match(statistics.answer, new RegExp(`\\b${totalRuns}\\b`));
  assert.match(statistics.answer, new RegExp(`\\b${succeededRuns}\\b`));
  if (failedRuns > 0) assert.match(statistics.answer, new RegExp(`\\b${failedRuns}\\b`));

  const listing = await runRepositoryChat({ ...common, prompt: "List the names of every paper in this repository." });
  assert.equal(listing.execution?.operation, "list_documents");
  assert.equal(listing.coverage?.eligiblePapers, succeededRuns);
  assert.equal(listing.coverage?.returnedPapers, succeededRuns);
  assert.equal(listing.coverage?.complete, true);

  const explanations = await runRepositoryChat({ ...common, prompt: "Explain each paper in this repository." });
  assert.equal(explanations.execution?.operation, "analyze_each_document");
  assert.equal(explanations.coverage?.processedPapers, succeededRuns);
  assert.equal(explanations.coverage?.returnedPapers, succeededRuns);
  assert.equal(explanations.coverage?.complete, true);

  const chart = await runRepositoryChat({
    ...common,
    prompt: "Display the repository topics as a bar chart.",
  });
  assert.equal(chart.handled, true);
  assert.equal(chart.plan.intent, "topic_chart");
  assert.equal(chart.plan.retrievalMode, "exhaustive");
  assert.ok(chart.charts.length > 0, "Repository topic chart was not generated.");

  const allProjects = await runRepositoryChat({
    ownerUserId,
    knowledgeScope: { kind: "all_projects" },
    prompt: "What's in this repository?",
  });
  assert.equal(allProjects.handled, true);
  assert.equal(allProjects.execution?.operation, "inspect_scope");
  assert.equal(allProjects.scopeSnapshot.kind, "all_projects");
  assert.equal(allProjects.scopeSnapshot.label, "All projects");
  assert.ok(allProjects.diagnostics.paperCount >= succeededRuns);

  const capabilities = await runRepositoryChat({
    ownerUserId,
    knowledgeScope: { kind: "all_projects" },
    prompt: "What can you do?",
  });
  assert.equal(capabilities.handled, true);
  assert.equal(capabilities.execution?.operation, "converse");
  assert.doesNotMatch(capabilities.answer, /do not have access to your (?:local|private)/i);

  console.log(JSON.stringify({
    ok: true,
    projectId,
    folderId,
    totalRuns,
    succeededRuns,
    failedRuns,
    dashboard: {
      trendRows: dashboard.trends.length,
      singleTrackRows: dashboard.tracksSingle.length,
      multiTrackRows: dashboard.tracksMulti.length,
      topicFamilies: dashboard.topicFamilies?.length ?? 0,
    },
    statistics: {
      intent: statistics.plan.intent,
      planner: statistics.plan.source,
      reportedPaperCount: statistics.diagnostics.paperCount,
    },
    chart: {
      intent: chart.plan.intent,
      retrievalMode: chart.plan.retrievalMode,
      chartCount: chart.charts.length,
    },
    exhaustive: {
      listed: listing.coverage?.returnedPapers,
      explained: explanations.coverage?.returnedPapers,
      complete: listing.coverage?.complete && explanations.coverage?.complete,
    },
    knowledgeV3: {
      allProjectPapers: allProjects.diagnostics.paperCount,
      transcriptRoute: allProjects.execution?.operation,
      capabilityRoute: capabilities.execution?.operation,
    },
  }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
