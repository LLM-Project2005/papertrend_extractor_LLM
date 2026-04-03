import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ChatThreadDetail,
  DeepResearchSessionRecord,
  DeepResearchStepRecord,
  WorkspaceMessageRecord,
  WorkspaceThreadSummary,
} from "@/types/research";

function normalizeFolderId(folderId?: string | null): string | null {
  if (!folderId || folderId === "all") {
    return null;
  }
  return folderId;
}

export function buildThreadTitle(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed || "Untitled chat";
}

export async function listWorkspaceThreads(
  supabase: SupabaseClient,
  ownerUserId: string,
  folderId?: string | null
): Promise<WorkspaceThreadSummary[]> {
  let query = supabase
    .from("workspace_threads")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .order("updated_at", { ascending: false });

  const normalizedFolderId = normalizeFolderId(folderId);
  if (normalizedFolderId) {
    query = query.eq("folder_id", normalizedFolderId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as WorkspaceThreadSummary[];
}

export async function createWorkspaceThread(
  supabase: SupabaseClient,
  input: {
    ownerUserId: string;
    folderId?: string | null;
    mode: "normal" | "deep_research";
    title: string;
    summary?: string | null;
  }
): Promise<WorkspaceThreadSummary> {
  const { data, error } = await supabase
    .from("workspace_threads")
    .insert({
      owner_user_id: input.ownerUserId,
      folder_id: normalizeFolderId(input.folderId),
      mode: input.mode,
      title: input.title,
      summary: input.summary ?? null,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create workspace thread.");
  }

  return data as WorkspaceThreadSummary;
}

export async function updateWorkspaceThread(
  supabase: SupabaseClient,
  threadId: string,
  patch: Partial<WorkspaceThreadSummary>
): Promise<void> {
  const { error } = await supabase
    .from("workspace_threads")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", threadId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function appendWorkspaceMessage(
  supabase: SupabaseClient,
  input: {
    threadId: string;
    ownerUserId: string;
    folderId?: string | null;
    role: "user" | "assistant" | "system";
    messageKind?: "chat" | "deep_research_plan" | "deep_research_report" | "status";
    content: string;
    citations?: unknown[];
    metadata?: Record<string, unknown>;
  }
): Promise<WorkspaceMessageRecord> {
  const { data, error } = await supabase
    .from("workspace_messages")
    .insert({
      thread_id: input.threadId,
      owner_user_id: input.ownerUserId,
      folder_id: normalizeFolderId(input.folderId),
      role: input.role,
      message_kind: input.messageKind ?? "chat",
      content: input.content,
      citations: input.citations ?? [],
      metadata: input.metadata ?? {},
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to append workspace message.");
  }

  return {
    ...(data as WorkspaceMessageRecord),
    citations: Array.isArray((data as { citations?: unknown[] }).citations)
      ? ((data as { citations?: unknown[] }).citations as WorkspaceMessageRecord["citations"])
      : [],
  };
}

export async function replaceDeepResearchPlan(
  supabase: SupabaseClient,
  input: {
    threadId: string;
    ownerUserId: string;
    folderId?: string | null;
    sessionId?: string | null;
    prompt: string;
    title: string;
    summary: string;
    requiresAnalysis: boolean;
    pendingRunCount: number;
    steps: Array<{
      position: number;
      title: string;
      description: string;
      tool_name: string;
      tool_input: Record<string, unknown>;
    }>;
  }
): Promise<DeepResearchSessionRecord> {
  let sessionId = input.sessionId ?? null;
  if (sessionId) {
    const { error: updateError } = await supabase
      .from("deep_research_sessions")
      .update({
        prompt: input.prompt,
        plan_summary: input.summary,
        requires_analysis: input.requiresAnalysis,
        pending_run_count: input.pendingRunCount,
        status: "planned",
        final_report: null,
        last_error: null,
        updated_at: new Date().toISOString(),
        completed_at: null,
      })
      .eq("id", sessionId);
    if (updateError) {
      throw new Error(updateError.message);
    }
    const { error: deleteError } = await supabase
      .from("deep_research_steps")
      .delete()
      .eq("session_id", sessionId);
    if (deleteError) {
      throw new Error(deleteError.message);
    }
  } else {
    const { data: createdSession, error: createError } = await supabase
      .from("deep_research_sessions")
      .insert({
        thread_id: input.threadId,
        owner_user_id: input.ownerUserId,
        folder_id: normalizeFolderId(input.folderId),
        prompt: input.prompt,
        plan_summary: input.summary,
        requires_analysis: input.requiresAnalysis,
        pending_run_count: input.pendingRunCount,
        status: "planned",
        updated_at: new Date().toISOString(),
      })
      .select("*")
      .single();
    if (createError || !createdSession) {
      throw new Error(createError?.message ?? "Failed to create deep research session.");
    }
    sessionId = String(createdSession.id);
  }

  const stepsPayload = input.steps.map((step) => ({
    session_id: sessionId,
    owner_user_id: input.ownerUserId,
    position: step.position,
    title: step.title,
    description: step.description,
    tool_name: step.tool_name,
    status: "planned",
    input_payload: step.tool_input,
    output_payload: {},
    updated_at: new Date().toISOString(),
  }));

  if (stepsPayload.length > 0) {
    const { error: stepsError } = await supabase
      .from("deep_research_steps")
      .insert(stepsPayload);
    if (stepsError) {
      throw new Error(stepsError.message);
    }
  }

  const { error: planMessageDeleteError } = await supabase
    .from("workspace_messages")
    .delete()
    .eq("thread_id", input.threadId)
    .eq("message_kind", "deep_research_plan");
  if (planMessageDeleteError) {
    throw new Error(planMessageDeleteError.message);
  }

  await appendWorkspaceMessage(supabase, {
    threadId: input.threadId,
    ownerUserId: input.ownerUserId,
    folderId: input.folderId,
    role: "assistant",
    messageKind: "deep_research_plan",
    content: input.summary,
    metadata: {
      sessionId,
      requiresAnalysis: input.requiresAnalysis,
      pendingRunCount: input.pendingRunCount,
    },
  });

  await updateWorkspaceThread(supabase, input.threadId, {
    title: input.title,
    summary: input.summary,
  });

  return getDeepResearchSession(supabase, sessionId);
}

export async function getDeepResearchSession(
  supabase: SupabaseClient,
  sessionId: string
): Promise<DeepResearchSessionRecord> {
  const { data: session, error: sessionError } = await supabase
    .from("deep_research_sessions")
    .select("*")
    .eq("id", sessionId)
    .single();
  if (sessionError || !session) {
    throw new Error(sessionError?.message ?? "Failed to load deep research session.");
  }

  const { data: steps, error: stepsError } = await supabase
    .from("deep_research_steps")
    .select("*")
    .eq("session_id", sessionId)
    .order("position", { ascending: true });
  if (stepsError) {
    throw new Error(stepsError.message);
  }

  return {
    ...(session as DeepResearchSessionRecord),
    steps: (steps ?? []) as DeepResearchStepRecord[],
  };
}

export async function getWorkspaceThreadDetail(
  supabase: SupabaseClient,
  ownerUserId: string,
  threadId: string
): Promise<ChatThreadDetail> {
  const { data: thread, error: threadError } = await supabase
    .from("workspace_threads")
    .select("*")
    .eq("id", threadId)
    .eq("owner_user_id", ownerUserId)
    .single();
  if (threadError || !thread) {
    throw new Error(threadError?.message ?? "Failed to load workspace thread.");
  }

  const { data: messages, error: messagesError } = await supabase
    .from("workspace_messages")
    .select("*")
    .eq("thread_id", threadId)
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: true });
  if (messagesError) {
    throw new Error(messagesError.message);
  }

  const { data: sessions, error: sessionsError } = await supabase
    .from("deep_research_sessions")
    .select("*")
    .eq("thread_id", threadId)
    .eq("owner_user_id", ownerUserId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (sessionsError) {
    throw new Error(sessionsError.message);
  }

  const deepResearchSession =
    sessions && sessions.length > 0
      ? await getDeepResearchSession(supabase, String(sessions[0].id))
      : null;

  return {
    thread: thread as WorkspaceThreadSummary,
    messages: ((messages ?? []) as WorkspaceMessageRecord[]).map((message) => ({
      ...message,
      citations: Array.isArray((message as { citations?: unknown[] }).citations)
        ? ((message as { citations?: unknown[] }).citations as WorkspaceMessageRecord["citations"])
        : [],
    })),
    deepResearchSession,
  };
}
