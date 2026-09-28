import { NextResponse } from "next/server";
import { getAuthenticatedIdentityFromRequest } from "@/lib/auth/adapter";
import { unlinkedReason } from "@/lib/auth/account-linking";
import { redeemInviteForIdentity } from "@/lib/cloudsql/identity-repository";
import { hashInviteCode, INVITE_REFUSED_MESSAGE, normalizeInviteCode } from "@/lib/invite-codes";
import { assertInviteRedeemRateLimit, GuardError } from "@/lib/security-guards";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";

/*
 * Redeems an invite code for the signed-in Firebase account, creating its
 * Papertrend account. The code is never logged or echoed back, and every
 * refusal - wrong, used, expired, revoked, or meant for someone else - gets the
 * same answer, so a response says nothing about which codes exist.
 */
export async function POST(request: Request) {
  if (getDatabaseProvider() !== "cloud-sql") {
    return NextResponse.json({ error: "Invite codes are not available here." }, { status: 404 });
  }

  const identity = await getAuthenticatedIdentityFromRequest(request, { timeoutMs: 8_000 });
  if (!identity || identity.provider !== "firebase") {
    return NextResponse.json({ error: "Sign in first, then enter your invite code." }, { status: 401 });
  }
  if (identity.ownerUserId) {
    return NextResponse.json({ ok: true, alreadyMember: true });
  }
  if (identity.mappingStatus === "lookup_failed") {
    return NextResponse.json({ error: "Sign-in is temporarily unavailable. Try again in a moment." }, { status: 503 });
  }
  // An unconfirmed email and password account confirms its address first, so
  // a code cannot be spent on an address its user does not own.
  const reason = unlinkedReason(identity.claims, identity.email);
  if (reason.code === "email_unverified") {
    return NextResponse.json({ error: reason.message, code: reason.code }, { status: 403 });
  }

  try {
    await assertInviteRedeemRateLimit(request, identity.subject);
  } catch (error) {
    if (error instanceof GuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = normalizeInviteCode(body?.code);
  if (!code) {
    return NextResponse.json({ error: INVITE_REFUSED_MESSAGE }, { status: 400 });
  }

  let result;
  try {
    result = await redeemInviteForIdentity(identity, hashInviteCode(code));
  } catch (error) {
    console.error("Invite redemption failed unexpectedly.", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json({ error: "Invite codes can't be checked right now. Try again in a moment." }, { status: 503 });
  }

  if (result.status === "linked") {
    return NextResponse.json({ ok: true });
  }
  if (result.status === "refused") {
    const refusal = unlinkedReason(identity.claims, identity.email);
    return NextResponse.json({ error: refusal.message, code: refusal.code }, { status: 403 });
  }
  return NextResponse.json({ error: INVITE_REFUSED_MESSAGE }, { status: 400 });
}
