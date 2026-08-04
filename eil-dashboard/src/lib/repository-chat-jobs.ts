import { randomUUID, timingSafeEqual } from "node:crypto";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { getGoogleCloudProjectId, getGoogleCloudRegion, getWorkerWebhookSecret } from "@/lib/server-env";
import type { RepositoryChatInput, RepositoryChatResult, RepositoryExecutionPlan } from "@/lib/repository-chat";

export interface RepositoryChatJob {
  id: string;
  ownerUserId: string;
  status: "queued" | "processing" | "succeeded" | "failed" | "canceled";
  progressCurrent: number;
  progressTotal: number;
  resultText: string | null;
  citations: unknown[];
  charts: unknown[];
  coverage: Record<string, unknown>;
  limitations: string[];
  errorMessage: string | null;
  executionPlan: Record<string, unknown>;
}

function mapJob(row: Record<string, unknown>): RepositoryChatJob {
  return {
    id: String(row.id), ownerUserId: String(row.owner_user_id), status: row.status as RepositoryChatJob["status"],
    progressCurrent: Number(row.progress_current ?? 0), progressTotal: Number(row.progress_total ?? 0),
    resultText: typeof row.result_text === "string" ? row.result_text : null,
    citations: Array.isArray(row.citations) ? row.citations : [], charts: Array.isArray(row.charts) ? row.charts : [],
    coverage: row.coverage && typeof row.coverage === "object" ? row.coverage as Record<string, unknown> : {},
    limitations: Array.isArray(row.limitations) ? row.limitations.map(String) : [],
    errorMessage: typeof row.error_message === "string" ? row.error_message : null,
    executionPlan: row.execution_plan && typeof row.execution_plan === "object" ? row.execution_plan as Record<string, unknown> : {},
  };
}

export async function createRepositoryChatJob(input: RepositoryChatInput, plan: RepositoryExecutionPlan, total: number): Promise<string> {
  const id = randomUUID();
  await withCloudSqlOwnerTransaction(input.ownerUserId, async (client) => {
    await client.query(
      `INSERT INTO repository_chat_jobs
       (id,owner_user_id,thread_id,project_id,folder_id,prompt,execution_plan,progress_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [id, input.ownerUserId, input.threadId ?? null, input.projectId, input.folderId ?? null, input.prompt,
        JSON.stringify({ ...plan, ownerUserId: input.ownerUserId, threadId: input.threadId ?? null,
          projectId: input.projectId, folderId: input.folderId ?? null, prompt: input.prompt,
          selectedRunIds: input.selectedRunIds ?? [], model: input.model ?? null }), total]
    );
  });
  return id;
}

export async function getRepositoryChatJob(ownerUserId: string, id: string): Promise<RepositoryChatJob | null> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query(`SELECT * FROM repository_chat_jobs WHERE id=$1 AND owner_user_id=$2`, [id, ownerUserId]);
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  });
}

export async function claimRepositoryChatJob(ownerUserId: string, id: string): Promise<RepositoryChatJob | null> {
  return withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const result = await client.query(
      `UPDATE repository_chat_jobs SET status='processing', updated_at=now()
       WHERE id=$1 AND owner_user_id=$2 AND status='queued' RETURNING *`, [id, ownerUserId]
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  });
}

export async function completeRepositoryChatJob(ownerUserId: string, id: string, result: RepositoryChatResult): Promise<void> {
  await withCloudSqlOwnerTransaction(ownerUserId, (client) => client.query(
    `UPDATE repository_chat_jobs SET status='succeeded', progress_current=progress_total,
       result_text=$2,citations=$3::jsonb,charts=$4::jsonb,coverage=$5::jsonb,limitations=$6::jsonb,
       completed_at=now(),updated_at=now() WHERE id=$1 AND owner_user_id=$7`,
    [id, result.answer, JSON.stringify(result.citations), JSON.stringify(result.charts),
      JSON.stringify(result.coverage ?? {}), JSON.stringify(result.limitations ?? []), ownerUserId]
  ).then(() => undefined));
}

export async function failRepositoryChatJob(ownerUserId: string, id: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await withCloudSqlOwnerTransaction(ownerUserId, (client) => client.query(
    `UPDATE repository_chat_jobs SET status='failed',error_message=$2,completed_at=now(),updated_at=now() WHERE id=$1 AND owner_user_id=$3`,
    [id, message.slice(0, 1_000), ownerUserId]
  ).then(() => undefined));
}

export function isRepositoryJobSecretValid(value: string): boolean {
  const expected = getWorkerWebhookSecret();
  if (!expected || !value) return false;
  const left = Buffer.from(value); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function enqueueRepositoryChatJob(id: string, ownerUserId: string, callbackBaseUrl: string): Promise<boolean> {
  const project = getGoogleCloudProjectId();
  const location = process.env.CLOUD_TASKS_LOCATION ?? getGoogleCloudRegion();
  const queue = process.env.REPOSITORY_CHAT_TASKS_QUEUE ?? process.env.CLOUD_TASKS_QUEUE ?? "";
  if (!project || !queue || !callbackBaseUrl) return false;
  const tokenResponse = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" },
  });
  if (!tokenResponse.ok) return false;
  const { access_token: accessToken } = await tokenResponse.json() as { access_token?: string };
  if (!accessToken) return false;
  const response = await fetch(`https://cloudtasks.googleapis.com/v2/projects/${project}/locations/${location}/queues/${queue}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ task: { httpRequest: {
      httpMethod: "POST",
      url: `${callbackBaseUrl.replace(/\/$/, "")}/api/chat/jobs/process`,
      headers: { "Content-Type": "application/json", "x-worker-secret": getWorkerWebhookSecret() },
      body: Buffer.from(JSON.stringify({ jobId: id, ownerUserId })).toString("base64"),
    } } }),
  });
  return response.ok;
}
