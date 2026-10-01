import { NextResponse } from "next/server";
import { z } from "zod";
import { isVerifiedServiceCaller } from "@/lib/cloud-tasks-oidc";
import { indexRunForSearch } from "@/lib/search-index";
import { trackModelSpend } from "@/lib/security-guards";

export const runtime = "nodejs";
export const maxDuration = 120;

const BodySchema = z.object({ ownerUserId: z.string().uuid(), runId: z.string().uuid() });

/**
 * Indexes one analysed paper for semantic search (docs/32, 2.3). Called by
 * the analysis worker when a run succeeds, and by its scheduled catch-up; only
 * this service's own tasks and the worker's account, by Google-signed token.
 * The owner comes from that verified caller, never from a browser.
 */
export async function POST(request: Request) {
  if (!(await isVerifiedServiceCaller(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid index request." }, { status: 400 });
  const { ownerUserId, runId } = parsed.data;
  try {
    const result = await trackModelSpend(ownerUserId, "search-index", () => indexRunForSearch(ownerUserId, runId));
    console.info("search_index_updated", JSON.stringify({ runId, ...result }));
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("search_index_failed", { runId, message: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
