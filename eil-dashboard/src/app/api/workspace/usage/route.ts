import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { readAiUsageToday } from "@/lib/ai-usage-today";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";

/**
 * The signed-in account's AI use today against its daily limits, for the usage
 * meter beside the chat composer. Read-only; who is asking comes from the
 * verified sign-in.
 */
export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (getDatabaseProvider() !== "cloud-sql") return NextResponse.json({ error: "Not available here." }, { status: 501 });
  try {
    return NextResponse.json(await readAiUsageToday(user.id), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Reading today's AI usage failed.", { message: error instanceof Error ? error.message : "unknown_error" });
    return NextResponse.json({ error: "Usage can't be read right now." }, { status: 503 });
  }
}
