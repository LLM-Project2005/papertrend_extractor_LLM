import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUserFromRequest } from "@/lib/admin-auth";
import {
  AccessRequestStateError,
  declineAccessRequest,
  deleteAccessRequest,
  inviteFromAccessRequest,
} from "@/lib/cloudsql/access-request-repository";
import { InviteLimitError } from "@/lib/cloudsql/invite-repository";
import { ACCESS_REQUEST_INVITE_DAYS } from "@/lib/access-request-limits";
import { formatInviteCode, INVITE_MAX_EXPIRY_DAYS } from "@/lib/invite-codes";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AnswerSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("invite"),
    expiresInDays: z.number().int().min(1).max(INVITE_MAX_EXPIRY_DAYS).default(ACCESS_REQUEST_INVITE_DAYS),
  }),
  z.object({ action: z.literal("decline") }),
]);

type Guarded = { ok: true; adminId: string; requestId: string } | { ok: false; response: NextResponse };

async function guard(request: Request, params: Promise<{ requestId: string }>): Promise<Guarded> {
  if (getDatabaseProvider() !== "cloud-sql") {
    return { ok: false, response: NextResponse.json({ error: "Access requests are not available here." }, { status: 404 }) };
  }
  const admin = await getAdminUserFromRequest(request);
  if (!admin) {
    return { ok: false, response: NextResponse.json({ error: "Only an admin can answer access requests." }, { status: 403 }) };
  }
  const { requestId } = await params;
  if (!UUID_PATTERN.test(requestId)) {
    return { ok: false, response: NextResponse.json({ error: "That request no longer exists." }, { status: 404 }) };
  }
  return { ok: true, adminId: admin.id, requestId };
}

/**
 * Admins only: answers a waiting request. "invite" makes a one-use code bound
 * to the request's email and returns it once; "decline" closes the request.
 */
export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const checked = await guard(request, params);
  if (!checked.ok) return checked.response;
  const parsed = AnswerSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Choose to invite or decline." }, { status: 400 });
  try {
    if (parsed.data.action === "decline") {
      return NextResponse.json({ request: await declineAccessRequest({ requestId: checked.requestId, adminId: checked.adminId }) });
    }
    const { code, invite, request: answered } = await inviteFromAccessRequest({
      requestId: checked.requestId,
      adminId: checked.adminId,
      expiresInDays: parsed.data.expiresInDays,
    });
    return NextResponse.json(
      { code: formatInviteCode(code), invite, request: answered },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof AccessRequestStateError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof InviteLimitError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Answering an access request failed.", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "The request couldn't be answered right now." }, { status: 503 });
  }
}

/** Admins only: deletes a request at once, as its sender may ask under the privacy policy. */
export async function DELETE(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const checked = await guard(request, params);
  if (!checked.ok) return checked.response;
  try {
    const deleted = await deleteAccessRequest(checked.requestId);
    if (!deleted) return NextResponse.json({ error: "That request no longer exists." }, { status: 404 });
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Deleting an access request failed.", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "The request couldn't be deleted right now." }, { status: 503 });
  }
}
