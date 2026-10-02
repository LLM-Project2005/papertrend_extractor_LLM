import { NextResponse } from "next/server";
import { getAdminUserFromRequest } from "@/lib/admin-auth";
import { listAccessRequests } from "@/lib/cloudsql/access-request-repository";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";

/** Admins only: access requests, waiting ones first (docs/32, 4.1). */
export async function GET(request: Request) {
  if (getDatabaseProvider() !== "cloud-sql") {
    return NextResponse.json({ error: "Access requests are not available here." }, { status: 404 });
  }
  const admin = await getAdminUserFromRequest(request);
  if (!admin) return NextResponse.json({ error: "Only an admin can see access requests." }, { status: 403 });
  try {
    return NextResponse.json({ requests: await listAccessRequests() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Listing access requests failed.", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "Access requests can't be loaded right now." }, { status: 503 });
  }
}
