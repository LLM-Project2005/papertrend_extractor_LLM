import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
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
  threadId: string | null;
  folderId: string | null;
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
    threadId: typeof row.thread_id === "string" ? row.thread_id : null,
    folderId: typeof row.folder_id === "string" ? row.folder_id : null,
  };
}

function stableUuid(value: string): string {
  const bytes = Buffer.from(createHash("sha256").update(value).digest().subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function jobMessageMetadata(id: string, status: RepositoryChatJob["status"], plan: Record<string, unknown>) {
  return {
    mode: status === "succeeded" ? "grounded" : status === "failed" ? "fallback" : "analysis_queued",
    repositoryJobId: id,
    repositoryJobStatus: status,
    repositoryExecution: plan,
  };
}

export async function createRepositoryChatJob(input: RepositoryChatInput, plan: RepositoryExecutionPlan, total: number): Promise<string> {
  const id = input.sourceMessageId
    ? stableUuid(`papertrend:repository-chat:${input.ownerUserId}:${input.sourceMessageId}:${input.prompt}`)
    : randomUUID();
  const assistantMessageId = stableUuid(`papertrend:repository-chat:assistant:${id}`);
  await withCloudSqlOwnerTransaction(input.ownerUserId, async (client) => {
    await client.query(
      `DELETE FROM repository_chat_jobs
       WHERE id IN (
         SELECT id FROM repository_chat_jobs
         WHERE owner_user_id=$1 AND completed_at < now() - interval '30 days'
         ORDER BY completed_at ASC LIMIT 100
       )`,
      [input.ownerUserId]
    );
    const executionPlan = {
      ...plan,
      ownerUserId: input.ownerUserId,
      threadId: input.threadId ?? null,
      projectId: input.projectId ?? null,
      folderId: input.folderId ?? null,
      prompt: input.prompt,
      selectedRunIds: input.selectedRunIds ?? [],
      knowledgeScope: input.knowledgeScope ?? null,
      model: input.model ?? null,
      allowWeb: Boolean(input.allowWeb),
      forceChart: Boolean(input.forceChart),
      history: (input.history ?? []).slice(-12),
      sourceMessageId: input.sourceMessageId ?? null,
      assistantMessageId,
    };
    await client.query(
      `INSERT INTO repository_chat_jobs
       (id,owner_user_id,thread_id,project_id,folder_id,prompt,execution_plan,progress_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
       ON CONFLICT (id) DO NOTHING`,
      [id, input.ownerUserId, input.threadId ?? null, input.projectId ?? null, input.folderId ?? null, input.prompt,
        JSON.stringify(executionPlan), total]
    );

    if (input.threadId && input.sourceMessageId) {
      const jobResult = await client.query<Record<string, unknown>>(
        `SELECT * FROM repository_chat_jobs WHERE id=$1 AND owner_user_id=$2 LIMIT 1`,
        [id, input.ownerUserId]
      );
      const job = jobResult.rows[0] ? mapJob(jobResult.rows[0]) : null;
      if (!job || job.status === "canceled") return;
      const completed = job.status === "succeeded";
      const failed = job.status === "failed";
      const content = completed
        ? job.resultText ?? "Repository analysis completed."
        : failed
          ? job.errorMessage ?? "Repository analysis could not be completed."
          : "Analyzing the selected Papertrend knowledge scope in the background...";
      const metadata = {
        ...jobMessageMetadata(id, job.status, executionPlan),
        charts: completed ? job.charts : [],
        repositoryCoverage: completed ? job.coverage : null,
        repositoryLimitations: completed ? job.limitations : [],
      };
      await client.query(
        `INSERT INTO public.workspace_messages
           (id,thread_id,owner_user_id,folder_id,role,message_kind,content,citations,metadata,updated_at)
         SELECT $1,$2,$3,$4,'assistant','status',$5,$6::jsonb,$7::jsonb,now()
         WHERE EXISTS (
           SELECT 1 FROM public.workspace_messages
           WHERE id=$8 AND thread_id=$2 AND owner_user_id=$3 AND role='user'
         )
         ON CONFLICT (id) DO UPDATE SET
           content=EXCLUDED.content,
           citations=EXCLUDED.citations,
           metadata=EXCLUDED.metadata,
           message_kind=EXCLUDED.message_kind,
           updated_at=now()`,
        [assistantMessageId, input.threadId, input.ownerUserId, input.folderId ?? null,
          content, JSON.stringify(completed ? job.citations : []), JSON.stringify(metadata), input.sourceMessageId]
      );
    }
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
       WHERE id=$1 AND owner_user_id=$2
         AND (status='queued' OR (status='processing' AND updated_at < now() - interval '5 minutes'))
       RETURNING *`, [id, ownerUserId]
    );
    return result.rows[0] ? mapJob(result.rows[0]) : null;
  });
}

export async function heartbeatRepositoryChatJob(ownerUserId: string, id: string): Promise<void> {
  await withCloudSqlOwnerTransaction(ownerUserId, (client) => client.query(
    `UPDATE repository_chat_jobs SET updated_at=now()
     WHERE id=$1 AND owner_user_id=$2 AND status='processing'`,
    [id, ownerUserId]
  ).then(() => undefined));
}

export async function completeRepositoryChatJob(ownerUserId: string, id: string, result: RepositoryChatResult): Promise<void> {
  await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const updated = await client.query<Record<string, unknown>>(
      `UPDATE repository_chat_jobs SET status='succeeded', progress_current=progress_total,
         result_text=$2,citations=$3::jsonb,charts=$4::jsonb,coverage=$5::jsonb,limitations=$6::jsonb,
         completed_at=now(),updated_at=now()
       WHERE id=$1 AND owner_user_id=$7 AND status IN ('queued','processing') RETURNING *`,
      [id, result.answer, JSON.stringify(result.citations), JSON.stringify(result.charts),
        JSON.stringify(result.coverage ?? {}), JSON.stringify(result.limitations ?? []), ownerUserId]
    );
    if (!updated.rows[0]) return;
    const job = mapJob(updated.rows[0]);
    const assistantMessageId = String(job.executionPlan.assistantMessageId ?? "");
    if (!assistantMessageId || !job.threadId) return;
    const metadata = {
      ...jobMessageMetadata(id, "succeeded", job.executionPlan),
      charts: result.charts,
      repositoryCoverage: result.coverage ?? null,
      repositoryLimitations: result.limitations ?? [],
      repositoryDiagnostics: result.diagnostics,
      scopeSnapshot: result.scopeSnapshot,
    };
    await client.query(
      `INSERT INTO public.workspace_messages
         (id,thread_id,owner_user_id,folder_id,role,message_kind,content,citations,metadata,updated_at)
       SELECT $1,$2,$3,$4,'assistant','chat',$5,$6::jsonb,$7::jsonb,now()
       WHERE EXISTS (SELECT 1 FROM public.workspace_threads WHERE id=$2 AND owner_user_id=$3)
       ON CONFLICT (id) DO UPDATE SET
         content=EXCLUDED.content,citations=EXCLUDED.citations,metadata=EXCLUDED.metadata,
         message_kind='chat',updated_at=now()`,
      [assistantMessageId, job.threadId, ownerUserId, job.folderId, result.answer,
        JSON.stringify(result.citations), JSON.stringify(metadata)]
    );
    await client.query(
      `UPDATE public.workspace_threads SET summary=$3,updated_at=now()
       WHERE id=$1 AND owner_user_id=$2`,
      [job.threadId, ownerUserId, result.answer.slice(0, 240)]
    );
  });
}

export async function failRepositoryChatJob(ownerUserId: string, id: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
    const updated = await client.query<Record<string, unknown>>(
      `UPDATE repository_chat_jobs SET status='failed',error_message=$2,completed_at=now(),updated_at=now()
       WHERE id=$1 AND owner_user_id=$3 AND status IN ('queued','processing') RETURNING *`,
      [id, message.slice(0, 1_000), ownerUserId]
    );
    if (!updated.rows[0]) return;
    const job = mapJob(updated.rows[0]);
    const assistantMessageId = String(job.executionPlan.assistantMessageId ?? "");
    if (!assistantMessageId || !job.threadId) return;
    await client.query(
      `UPDATE public.workspace_messages
       SET content=$4,metadata=$5::jsonb,message_kind='status',updated_at=now()
       WHERE id=$1 AND thread_id=$2 AND owner_user_id=$3`,
      [assistantMessageId, job.threadId, ownerUserId,
        "The repository analysis could not be completed. Retry this message; no partial answer was substituted.",
        JSON.stringify({ ...jobMessageMetadata(id, "failed", job.executionPlan), repositoryLimitations: [message.slice(0, 1_000)] })]
    );
  });
}

export async function cancelRepositoryChatJobsAfter(
  ownerUserId: string,
  threadId: string,
  createdAt: string
): Promise<void> {
  await withCloudSqlOwnerTransaction(ownerUserId, (client) => client.query(
    `UPDATE repository_chat_jobs
     SET status='canceled',completed_at=now(),updated_at=now()
     WHERE owner_user_id=$1 AND thread_id=$2 AND status IN ('queued','processing')
       AND created_at > $3::timestamptz`,
    [ownerUserId, threadId, createdAt]
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
    body: JSON.stringify({ task: {
      name: `projects/${project}/locations/${location}/queues/${queue}/tasks/repository-chat-${id}`,
      httpRequest: {
      httpMethod: "POST",
      url: `${callbackBaseUrl.replace(/\/$/, "")}/api/chat/jobs/process`,
      headers: { "Content-Type": "application/json", "x-worker-secret": getWorkerWebhookSecret() },
      body: Buffer.from(JSON.stringify({ jobId: id, ownerUserId })).toString("base64"),
    },
      dispatchDeadline: "1800s",
    } }),
  });
  return response.ok || response.status === 409;
}
