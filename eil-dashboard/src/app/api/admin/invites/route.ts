import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminUserFromRequest } from "@/lib/admin-auth";
import { createInviteCode, InviteLimitError, listInviteCodes } from "@/lib/cloudsql/invite-repository";
import {
  formatInviteCode,
  INVITE_DEFAULT_EXPIRY_DAYS,
  INVITE_MAX_EXPIRY_DAYS,
  INVITE_MAX_USES,
} from "@/lib/invite-codes";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";

const CreateInviteSchema = z.object({
  label: z.string().trim().max(80).default(""),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email().max(254)]).optional(),
  maxUses: z.number().int().min(1).max(INVITE_MAX_USES).default(1),
  expiresInDays: z.number().int().min(1).max(INVITE_MAX_EXPIRY_DAYS).default(INVITE_DEFAULT_EXPIRY_DAYS),
});

function unavailable() {
  return NextResponse.json({ error: "Invite codes are not available here." }, { status: 404 });
}

/** Admins only: the invite codes, newest first. Codes themselves are never stored, so never listed. */
export async function GET(request: Request) {
  if (getDatabaseProvider() !== "cloud-sql") return unavailable();
  const admin = await getAdminUserFromRequest(request);
  if (!admin) return NextResponse.json({ error: "Only an admin can manage invite codes." }, { status: 403 });
  try {
    return NextResponse.json({ invites: await listInviteCodes() });
  } catch (error) {
    console.error("Listing invite codes failed.", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "Invite codes can't be loaded right now." }, { status: 503 });
  }
}

/** Admins only: makes a code and returns it once. */
export async function POST(request: Request) {
  if (getDatabaseProvider() !== "cloud-sql") return unavailable();
  const admin = await getAdminUserFromRequest(request);
  if (!admin) return NextResponse.json({ error: "Only an admin can manage invite codes." }, { status: 403 });

  const parsed = CreateInviteSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the invite's details: uses 1–50, expiry 1–90 days, a valid email." }, { status: 400 });
  }
  try {
    const { code, invite } = await createInviteCode({
      createdBy: admin.id,
      label: parsed.data.label,
      boundEmail: parsed.data.email ? parsed.data.email : null,
      maxUses: parsed.data.maxUses,
      expiresInDays: parsed.data.expiresInDays,
    });
    return NextResponse.json(
      { code: formatInviteCode(code), invite },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    if (error instanceof InviteLimitError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("Creating an invite code failed.", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "The invite code couldn't be made right now." }, { status: 503 });
  }
}
