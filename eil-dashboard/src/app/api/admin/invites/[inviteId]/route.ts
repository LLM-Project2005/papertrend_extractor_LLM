import { NextResponse } from "next/server";
import { getAdminUserFromRequest } from "@/lib/admin-auth";
import { revokeInviteCode } from "@/lib/cloudsql/invite-repository";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Admins only: revokes an invite code. Accounts it already created keep working. */
export async function DELETE(request: Request, { params }: { params: Promise<{ inviteId: string }> }) {
  if (getDatabaseProvider() !== "cloud-sql") {
    return NextResponse.json({ error: "Invite codes are not available here." }, { status: 404 });
  }
  const admin = await getAdminUserFromRequest(request);
  if (!admin) return NextResponse.json({ error: "Only an admin can manage invite codes." }, { status: 403 });

  const { inviteId } = await params;
  if (!UUID_PATTERN.test(inviteId)) {
    return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  }
  try {
    const invite = await revokeInviteCode(inviteId);
    if (!invite) return NextResponse.json({ error: "Invite not found." }, { status: 404 });
    return NextResponse.json({ invite });
  } catch (error) {
    console.error("Revoking an invite code failed.", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "The invite code couldn't be revoked right now." }, { status: 503 });
  }
}
