import { createHash } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  getAiDailyDeepResearchLimit,
  getAiDailyMessageLimit,
  getAiDailyTokenLimit,
  getAiDailyWebSearchLimit,
  getLoginEmailRateLimitAttempts,
  getLoginRateLimitAttempts,
  getLoginRateLimitWindowSeconds,
  getDatabaseProvider,
} from "@/lib/server-env";
import { withCloudSqlOwnerTransaction, withCloudSqlServiceTransaction } from "@/lib/cloudsql/client";
import { isQuotaExemptRole } from "@/lib/quota-policy";
import { safeReturnPath } from "@/lib/safe-return-path";
import { withAiTokenUsageTracking, type AiTokenUsageTotals } from "@/lib/ai-token-usage";
import { readSpendToday, spendMetadata, spendRefusal, type SpendSource } from "@/lib/spend-limits";

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
        return safeReturnPath(`${url.pathname}${url.search}${url.hash}`, fallback);
      }
    } catch {
      return fallback;
    }
    return fallback;
  }
  return safeReturnPath(raw, fallback);
}

/* -------------------------------------------- the fallback when the DB is down */

/**
 * Counts attempts inside this process, used only when the database cannot be
 * reached.
 *
 * The guard used to catch a database error, log a warning, and **allow the
 * request**. That is the worst of the two obvious choices: a database blip, or
 * a missing table, silently removed brute-force protection altogether and
 * nothing outwardly changed. The other obvious choice - refusing every login
 * while the database is unwell - locks out every legitimate user to stop an
 * attacker who may not exist.
 *
 * This is the third option. It is weaker than the database counter, because
 * Cloud Run runs several instances and each counts only its own traffic, so an
 * attacker spread across instances gets roughly one budget per instance. That
 * is a far smaller number than infinity, it costs a legitimate user nothing,
 * and it applies only while the database is unavailable.
 */
const memoryAttempts = new Map<string, number[]>();
const MEMORY_MAX_SUBJECTS = 5_000;

/**
 * Records an attempt and returns how many fall inside the window, including it.
 *
 * Exported because it is the whole of the fallback's behaviour, and a fallback
 * that only runs while the database is down is not something an integration test
 * will ever reach.
 */
export function countInMemory(subjectHash: string, windowMs: number, now: number): number {
  const cutoff = now - windowMs;
  const kept = (memoryAttempts.get(subjectHash) ?? []).filter((at) => at > cutoff);
  kept.push(now);
  if (!memoryAttempts.has(subjectHash) && memoryAttempts.size >= MEMORY_MAX_SUBJECTS) {
    // Insertion-ordered, so this drops the least recently added subject. Without
    // it, a flood of distinct addresses would grow this map without bound.
    const oldest = memoryAttempts.keys().next().value;
    if (oldest !== undefined) memoryAttempts.delete(oldest);
  }
  memoryAttempts.set(subjectHash, kept);
  return kept.length;
}

/** Test seam: forget every counted attempt. */
export function resetLoginRateLimitMemory(): void {
  memoryAttempts.clear();
}

const TOO_MANY = "Too many login attempts. Please wait and try again.";

/* ------------------------------------------------------------- login limiting */

export async function assertLoginRateLimit(request: Request, email: string): Promise<void> {
  const windowSeconds = getLoginRateLimitWindowSeconds();
  const ipHash = hashSubject(getClientIp(request));
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();

  /*
   * Two buckets, because they bound different things.
   *
   * The first is keyed on the email *and* the caller's address, and it is the
   * tight one - five failures stops a person fumbling their own password, and
   * stops one machine working through a list.
   *
   * The second is keyed on the email alone. The address in the first key comes
   * from `X-Forwarded-For`, which the caller writes, so rotating that header
   * earns a fresh bucket every time and the first limit bounds nothing at all
   * for an attacker who bothers. Nobody can rotate the account they are trying
   * to break into, so this one holds regardless of how the proxy chain is
   * arranged - which matters, because getting that chain wrong silently breaks
   * rate limiting rather than merely weakening it.
   */
  const buckets = [
    { hash: hashSubject(`${email}:${ipHash}`), limit: getLoginRateLimitAttempts() },
    { hash: hashSubject(`email:${email}`), limit: getLoginEmailRateLimitAttempts() },
  ];

  try {
    const blocked = await countPersistedAttempts(buckets, ipHash, since);
    if (blocked) throw new GuardError(TOO_MANY, 429);
    return;
  } catch (error) {
    if (error instanceof GuardError) throw error;
    console.warn("[security] login rate limit store unavailable; counting in memory", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }

  const now = Date.now();
  const windowMs = windowSeconds * 1000;
  for (const bucket of buckets) {
    if (countInMemory(bucket.hash, windowMs, now) > bucket.limit) {
      throw new GuardError(TOO_MANY, 429);
    }
  }
}

const TOO_MANY_INVITE_TRIES = "Too many invite code attempts. Wait an hour and try again.";

/**
 * Limits invite-code tries: 5 an hour for one signed-in account, and 200 an
 * hour from one address. Every try counts, successes too, and a class joining
 * together from one campus network shares one address: at 20 an hour the
 * twenty-first student was turned away (docs/32, 2.11, AUTH-4).
 *
 * The account bucket is the one that holds - the address comes from a header
 * the caller can write - and an account needs a real,
 * confirmed email or a Google or Facebook sign-in, so a fresh budget is not
 * free. Against a 79-bit code even thousands of accounts would get nowhere.
 */
export async function assertInviteRedeemRateLimit(request: Request, accountSubject: string): Promise<void> {
  const windowSeconds = 3_600;
  const ipHash = hashSubject(getClientIp(request));
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const buckets = [
    { hash: hashSubject(`invite-account:${accountSubject}`), limit: 5 },
    { hash: hashSubject(`invite-ip:${ipHash}`), limit: 200 },
  ];

  try {
    const blocked = await countPersistedAttempts(buckets, ipHash, since, "invite_redeem");
    if (blocked) throw new GuardError(TOO_MANY_INVITE_TRIES, 429);
    return;
  } catch (error) {
    if (error instanceof GuardError) throw error;
    console.warn("[security] invite rate limit store unavailable; counting in memory", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }

  const now = Date.now();
  for (const bucket of buckets) {
    if (countInMemory(bucket.hash, windowSeconds * 1000, now) > bucket.limit) {
      throw new GuardError(TOO_MANY_INVITE_TRIES, 429);
    }
  }
}

const TOO_MANY_ACCESS_REQUESTS = "Too many requests from here today. Try again tomorrow.";

/**
 * Limits the public access-request form (docs/32, 4.1), per day: 3 for one
 * email, 10 from one address, and 200 for the whole site. The form needs no
 * account, so the site-wide bucket is the one a caller cannot reset by
 * changing the address header or the email; it bounds what lands in the table
 * and in front of an admin.
 */
export async function assertAccessRequestRateLimit(request: Request, email: string): Promise<void> {
  const windowSeconds = 86_400;
  const ipHash = hashSubject(getClientIp(request));
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString();
  const buckets = [
    { hash: hashSubject(`access-email:${normalizeEmail(email)}`), limit: 3 },
    { hash: hashSubject(`access-ip:${ipHash}`), limit: 10 },
    { hash: hashSubject("access-site"), limit: 200 },
  ];

  try {
    const blocked = await countPersistedAttempts(buckets, ipHash, since, "access_request");
    if (blocked) throw new GuardError(TOO_MANY_ACCESS_REQUESTS, 429);
    return;
  } catch (error) {
    if (error instanceof GuardError) throw error;
    console.warn("[security] access request rate limit store unavailable; counting in memory", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
  }

  const now = Date.now();
  for (const bucket of buckets) {
    if (countInMemory(bucket.hash, windowSeconds * 1000, now) > bucket.limit) {
      throw new GuardError(TOO_MANY_ACCESS_REQUESTS, 429);
    }
  }
}

/**
 * Records one attempt against every bucket and reports whether any was already
 * at its limit.
 *
 * The decision is returned rather than thrown from inside the transaction: a
 * throw rolls the transaction back, which would discard the very rows that
 * record the attempt.
 */
async function countPersistedAttempts(
  buckets: Array<{ hash: string; limit: number }>,
  ipHash: string,
  since: string,
  bucketName = "password_auth"
): Promise<boolean> {
  if (getDatabaseProvider() === "cloud-sql") {
    return withCloudSqlServiceTransaction(async (client) => {
      let blocked = false;
      for (const bucket of buckets) {
        const result = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM public.security_rate_limit_events
           WHERE bucket=$3 AND subject_hash=$1 AND created_at >= $2`,
          [bucket.hash, since, bucketName]
        );
        if (Number(result.rows[0]?.count ?? 0) >= bucket.limit) blocked = true;
      }
      for (const bucket of buckets) {
        await client.query(
          `INSERT INTO public.security_rate_limit_events(bucket,subject_hash,ip_hash,action,allowed)
           VALUES($5,$1,$2,$3,$4)`,
          [bucket.hash, ipHash, blocked ? "blocked" : "attempt", !blocked, bucketName]
        );
      }
      return blocked;
    });
  }

  const supabase = getSupabaseAdmin();
  let blocked = false;
  for (const bucket of buckets) {
    const { count, error } = await supabase
      .from("security_rate_limit_events")
      .select("id", { count: "exact", head: true })
      .eq("bucket", bucketName)
      .eq("subject_hash", bucket.hash)
      .gte("created_at", since);
    if (error) throw error;
    if ((count ?? 0) >= bucket.limit) blocked = true;
  }
  const { error: insertError } = await supabase.from("security_rate_limit_events").insert(
    buckets.map((bucket) => ({
      bucket: bucketName,
      subject_hash: bucket.hash,
      ip_hash: ipHash,
      action: blocked ? "blocked" : "attempt",
      allowed: !blocked,
    }))
  );
  if (insertError) throw insertError;
  return blocked;
}

export type AiUsageKind = "chat_message" | "web_search" | "chart" | "deep_research";

/**
 * Today's uses of one kind by one person. Rows with a metric record what a
 * request used and cost; they are not requests, and counting them made each
 * chat message count twice.
 */
export const AI_USAGE_COUNT_SQL = `SELECT count(*)::text AS count FROM public.ai_usage_events
  WHERE owner_user_id=$1 AND usage_kind=$2 AND created_at >= $3 AND NOT (metadata ? 'metric')`;

/**
 * Refuses a request once today's model spend reaches the per-person or the
 * site-wide dollar limit (docs/32, 1.5; see spend-limits.ts). A spend that
 * cannot be read refuses too: the caller is about to spend model credit.
 */
export async function assertSpendAllowed(ownerUserId: string): Promise<void> {
  if (getDatabaseProvider() !== "cloud-sql") return;
  let state: Awaited<ReturnType<typeof readSpendToday>>;
  try {
    state = await readSpendToday(ownerUserId);
  } catch (error) {
    console.warn("spend_limit_unreadable", { message: error instanceof Error ? error.message : "unknown_error" });
    throw new GuardError("Usage could not be checked just now. Try again in a moment.", 503);
  }
  const refusal = spendRefusal(state);
  if (!refusal) return;
  // The "AI spending limit reached" alert counts the site-wide ones. Info, not
  // error: every refused request logs one, and the error alerts would repeat it.
  if (refusal.scope === "site") console.info("site_daily_spend_limit_reached", { siteUsd: state.siteUsd });
  else console.info("person_daily_spend_limit_reached", { personUsd: state.personUsd });
  throw new GuardError(refusal.message, 429);
}

/** For work with a quiet fallback (theme grouping, topic merges): whether it may spend now. */
export async function spendAllowed(ownerUserId: string): Promise<boolean> {
  try {
    await assertSpendAllowed(ownerUserId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runs work that calls models and records what it cost, even when it fails:
 * a failed call is still charged. For work that has no request of its own to
 * record it, such as a background job or a cache rebuild.
 */
export async function trackModelSpend<T>(ownerUserId: string, source: SpendSource, run: () => Promise<T>): Promise<T> {
  return withAiTokenUsageTracking(async (usage) => {
    try {
      return await run();
    } finally {
      await persistAiTokenUsage(ownerUserId, usage, source).catch((error) => {
        console.warn("model_spend_record_failed", { source, message: error instanceof Error ? error.message : "unknown_error" });
      });
    }
  });
}

export async function assertAiTokenBudget(ownerUserId: string): Promise<number> {
  await assertSpendAllowed(ownerUserId);
  const limit = getAiDailyTokenLimit();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const since = today.toISOString();

  if (getDatabaseProvider() === "cloud-sql") {
    const budget = await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      const profile = await client.query<{ role: string | null }>(
        `SELECT role FROM public.user_profiles WHERE id=$1 LIMIT 1`,
        [ownerUserId]
      );
      if (isQuotaExemptRole(profile.rows[0]?.role)) return { exempt: true, used: 0 };
      const result = await client.query<{ units: string }>(
        `SELECT COALESCE(sum(units), 0)::text AS units
         FROM public.ai_usage_events
         WHERE owner_user_id=$1 AND usage_kind='chat_message'
           AND metadata->>'metric'='tokens' AND created_at >= $2`,
        [ownerUserId, since]
      );
      return { exempt: false, used: Number(result.rows[0]?.units ?? 0) };
    });
    if (budget.exempt) return Number.MAX_SAFE_INTEGER;
    if (budget.used >= limit) {
      throw new GuardError(
        `Daily chat token limit reached (${limit.toLocaleString()} tokens). Please try again tomorrow.`,
        429
      );
    }
    return Math.max(0, limit - budget.used);
  }

  const supabase = getSupabaseAdmin();
  const { data: profile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", ownerUserId)
    .maybeSingle();
  if (isQuotaExemptRole(profile?.role)) return Number.MAX_SAFE_INTEGER;
  const { data, error } = await supabase
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

/**
 * Records what one request's model calls used and cost, in one row whose
 * `metadata.cost_usd` the dollar limits add up. `source` names the feature.
 */
export async function persistAiTokenUsage(
  ownerUserId: string,
  usage: Pick<AiTokenUsageTotals, "promptTokens" | "completionTokens" | "totalTokens" | "calls"> &
    Partial<Pick<AiTokenUsageTotals, "byModel" | "reportedUsd" | "reportedCalls">>,
  source: SpendSource = "chat"
): Promise<void> {
  if (usage.totalTokens <= 0 && usage.calls <= 0) return;
  const metadata = spendMetadata(usage, source);
  // units > 0 is a table constraint; a call that reported no tokens still cost something.
  const units = Math.max(1, usage.totalTokens);
  if (getDatabaseProvider() === "cloud-sql") {
    await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
      await client.query(
        `INSERT INTO public.ai_usage_events(owner_user_id,usage_kind,units,metadata)
         VALUES($1,'chat_message',$2,$3)`,
        [ownerUserId, units, metadata]
      );
    });
    return;
  }
  const { error } = await getSupabaseAdmin().from("ai_usage_events").insert({
    owner_user_id: ownerUserId,
    usage_kind: "chat_message",
    units,
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
    kind === "deep_research"
      ? getAiDailyDeepResearchLimit()
      : kind === "web_search"
        ? getAiDailyWebSearchLimit()
        : getAiDailyMessageLimit();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const since = today.toISOString();
  await assertSpendAllowed(ownerUserId);
  if (getDatabaseProvider() === "cloud-sql") {
    try {
      await withCloudSqlOwnerTransaction(ownerUserId, async (client) => {
        // Count and insert under one lock per person and kind. Without it,
        // parallel requests all read the same count, all pass, and the daily
        // limit is exceeded by however many were sent at once.
        await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
          `ai-usage:${ownerUserId}:${kind}`,
        ]);
        const profile = await client.query<{ role: string | null }>(
          `SELECT role FROM public.user_profiles WHERE id=$1 LIMIT 1`,
          [ownerUserId]
        );
        if (!isQuotaExemptRole(profile.rows[0]?.role)) {
          const result = await client.query<{ count: string }>(AI_USAGE_COUNT_SQL, [ownerUserId, kind, since]);
          if (Number(result.rows[0]?.count ?? 0) >= limit) {
            throw new GuardError("Daily AI usage limit reached. Please try again tomorrow.", 429);
          }
        }
        await client.query(
          `INSERT INTO public.ai_usage_events(owner_user_id,usage_kind,units,metadata)
           VALUES($1,$2,1,$3)`, [ownerUserId, kind, metadata ?? {}]
        );
      });
      return;
    } catch (error) {
      if (error instanceof GuardError) throw error;
      // Every kind here spends model credit, so an unreadable limit refuses
      // the request rather than waving it through; a database that cannot be
      // reached would fail the request moments later anyway.
      console.warn("[security] Cloud SQL AI usage guard unavailable; refusing request", { kind, message: error instanceof Error ? error.message : "unknown_error" });
      throw new GuardError("Usage could not be checked just now. Try again in a moment.", 503);
    }
  }
  const supabase = getSupabaseAdmin();

  try {
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("id", ownerUserId)
      .maybeSingle();
    if (!isQuotaExemptRole(profile?.role)) {
      const { count, error } = await supabase
        .from("ai_usage_events")
        .select("id", { count: "exact", head: true })
        .eq("owner_user_id", ownerUserId)
        .eq("usage_kind", kind)
        .gte("created_at", since);

      if (error) throw error;
      if ((count ?? 0) >= limit) {
        throw new GuardError("Daily AI usage limit reached. Please try again tomorrow.", 429);
      }
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
