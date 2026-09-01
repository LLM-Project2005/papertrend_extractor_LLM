import { createHash } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  getAiDailyDeepResearchLimit,
  getAiDailyMessageLimit,
  getAiDailyTokenLimit,
  getLoginRateLimitAttempts,
  getLoginRateLimitWindowSeconds,
  getDatabaseProvider,
} from "@/lib/server-env";
import { withCloudSqlOwnerTransaction, withCloudSqlServiceTransaction } from "@/lib/cloudsql/client";

export class GuardError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "GuardError";
    this.status = status;
  }
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }
  return (
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    "unknown"
  );
}

export function hashSubject(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function validateSafeReturnTo(value: unknown, fallback = "/workspaces"): string {
  const raw = String(value ?? "").trim();
  if (!raw || raw.startsWith("//")) {
    return fallback;
  }
  if (/^https?:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
      if (configured && url.origin === new URL(configured).origin) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
    } catch {
      return fallback;
    }
    return fallback;
  }
  return raw.startsWith("/") ? raw : fallback;
}

export async function assertLoginRateLimit(request: Request, email: string): Promise<void> {
  const limit = getLoginRateLimitAttempts();
  const windowSeconds = getLoginRateLimitWindowSeconds();
  const ipHash = hashSubject(getClientIp(request));
  const subjectHash = hashSubject(`${email}:${ipHash}`);
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  if (getDatabaseProvider() === "cloud-sql") {
    try {
      await withCloudSqlServiceTransaction(async (client) => {
        const result = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM public.security_rate_limit_events
           WHERE bucket='password_auth' AND subject_hash=$1 AND created_at >= $2`, [subjectHash, since]
        );
        const blocked = Number(result.rows[0]?.count ?? 0) >= limit;
        await client.query(
          `INSERT INTO public.security_rate_limit_events(bucket,subject_hash,ip_hash,action,allowed)
           VALUES('password_auth',$1,$2,$3,$4)`, [subjectHash, ipHash, blocked ? "blocked" : "attempt", !blocked]
        );
        if (blocked) throw new GuardError("Too many login attempts. Please wait and try again.", 429);
      });
      return;
    } catch (error) {
      if (error instanceof GuardError) throw error;
      console.warn("[security] Cloud SQL login rate limit unavailable; allowing request", { message: error instanceof Error ? error.message : "unknown_error" });
      return;
    }
  }
  const supabase = getSupabaseAdmin();

  try {
    const { count, error } = await supabase
      .from("security_rate_limit_events")
      .select("id", { count: "exact", head: true })
      .eq("bucket", "password_auth")
      .eq("subject_hash", subjectHash)
      .gte("created_at", since);

    if (error) {
      throw error;
    }

    if ((count ?? 0) >= limit) {
      await supabase.from("security_rate_limit_events").insert({
        bucket: "password_auth",
        subject_hash: subjectHash,
        ip_hash: ipHash,
        action: "blocked",
        allowed: false,
      });
      throw new GuardError("Too many login attempts. Please wait and try again.", 429);
    }

    await supabase.from("security_rate_limit_events").insert({
      bucket: "password_auth",
      subject_hash: subjectHash,
      ip_hash: ipHash,
      action: "attempt",
      allowed: true,
    });
  } catch (error) {
    if (error instanceof GuardError) {
      throw error;
    }
    console.warn("[security] login rate limit unavailable; allowing request", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}

export type AiUsageKind = "chat_message" | "web_search" | "chart" | "deep_research";

export async function assertAiTokenBudget(ownerUserId: string): Promise<number> {
  const limit = getAiDailyTokenLimit();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const since = today.toISOString();

  if (getDatabaseProvider() === "cloud-sql") {
    const used = await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const result = await client.query<{ units: string }>(
        `SELECT COALESCE(sum(units), 0)::text AS units
         FROM public.ai_usage_events
         WHERE owner_user_id=$1 AND usage_kind='chat_message'
           AND metadata->>'metric'='tokens' AND created_at >= $2`,
        [ownerUserId, since]
      );
      return Number(result.rows[0]?.units ?? 0);
    });
    if (used >= limit) {
      throw new GuardError(
        `Daily chat token limit reached (${limit.toLocaleString()} tokens). Please try again tomorrow.`,
        429
      );
    }
    return Math.max(0, limit - used);
  }

  const { data, error } = await getSupabaseAdmin()
    .from("ai_usage_events")
    .select("units")
    .eq("owner_user_id", ownerUserId)
    .eq("usage_kind", "chat_message")
    .contains("metadata", { metric: "tokens" })
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  const used = (data ?? []).reduce((total, row) => total + Number(row.units ?? 0), 0);
  if (used >= limit) {
    throw new GuardError(
      `Daily chat token limit reached (${limit.toLocaleString()} tokens). Please try again tomorrow.`,
      429
    );
  }
  return Math.max(0, limit - used);
}

export async function persistAiTokenUsage(
  ownerUserId: string,
  usage: { promptTokens: number; completionTokens: number; totalTokens: number; calls: number }
): Promise<void> {
  if (usage.totalTokens <= 0) return;
  const metadata = {
    metric: "tokens",
    prompt_tokens: usage.promptTokens,
    completion_tokens: usage.completionTokens,
    model_calls: usage.calls,
  };
  if (getDatabaseProvider() === "cloud-sql") {
    await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      await client.query(
        `INSERT INTO public.ai_usage_events(owner_user_id,usage_kind,units,metadata)
         VALUES($1,'chat_message',$2,$3)`,
        [ownerUserId, usage.totalTokens, metadata]
      );
    });
    return;
  }
  const { error } = await getSupabaseAdmin().from("ai_usage_events").insert({
    owner_user_id: ownerUserId,
    usage_kind: "chat_message",
    units: usage.totalTokens,
    metadata,
  });
  if (error) throw new Error(error.message);
}

export async function assertAndRecordAiUsage(
  ownerUserId: string,
  kind: AiUsageKind,
  metadata?: Record<string, unknown>
): Promise<void> {
  const limit =
    kind === "deep_research" ? getAiDailyDeepResearchLimit() : getAiDailyMessageLimit();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const since = today.toISOString();
  if (getDatabaseProvider() === "cloud-sql") {
    try {
      await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
        const result = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM public.ai_usage_events
           WHERE owner_user_id=$1 AND usage_kind=$2 AND created_at >= $3`, [ownerUserId, kind, since]
        );
        if (Number(result.rows[0]?.count ?? 0) >= limit) {
          throw new GuardError("Daily AI usage limit reached. Please try again tomorrow.", 429);
        }
        await client.query(
          `INSERT INTO public.ai_usage_events(owner_user_id,usage_kind,units,metadata)
           VALUES($1,$2,1,$3)`, [ownerUserId, kind, metadata ?? {}]
        );
      });
      return;
    } catch (error) {
      if (error instanceof GuardError) throw error;
      console.warn("[security] Cloud SQL AI usage guard unavailable; allowing request", { kind, message: error instanceof Error ? error.message : "unknown_error" });
      return;
    }
  }
  const supabase = getSupabaseAdmin();

  try {
    const { count, error } = await supabase
      .from("ai_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("owner_user_id", ownerUserId)
      .eq("usage_kind", kind)
      .gte("created_at", since);

    if (error) {
      throw error;
    }

    if ((count ?? 0) >= limit) {
      throw new GuardError("Daily AI usage limit reached. Please try again tomorrow.", 429);
    }

    await supabase.from("ai_usage_events").insert({
      owner_user_id: ownerUserId,
      usage_kind: kind,
      units: 1,
      metadata: metadata ?? {},
    });
  } catch (error) {
    if (error instanceof GuardError) {
      throw error;
    }
    console.warn("[security] AI usage guard unavailable; allowing request", {
      kind,
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }
}
