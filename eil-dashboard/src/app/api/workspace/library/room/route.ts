import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { cloudSqlIngestionRepository } from "@/lib/cloudsql/ingestion-repository";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";

/**
 * How many papers this account holds against its limit, so the upload dialog
 * can say how many more fit before anything is uploaded (docs/32, 4.5).
 */
export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (getDatabaseProvider() !== "cloud-sql") return NextResponse.json({ error: "Not available here." }, { status: 501 });
  try {
    const usage = await cloudSqlIngestionRepository.accountPaperUsage(user.id);
    return NextResponse.json(
      { used: usage.used, limit: usage.exempt ? null : usage.limit, remaining: usage.exempt ? null : Math.max(0, usage.limit - usage.used) },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Reading the account's paper count failed.", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "The paper count can't be read right now." }, { status: 503 });
  }
}
