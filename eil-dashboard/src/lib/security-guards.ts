import { createHash } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  getAiDailyDeepResearchLimit,
  getAiDailyMessageLimit,
  getLoginRateLimitAttempts,
  getLoginRateLimitWindowSeconds,
} from "@/lib/server-env";

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
