import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getDatabaseProvider } from "@/lib/server-env";
import {
  createSemanticMapJob,
  failSemanticMap,
  getSemanticMap,
  loadSemanticPaperDocuments,
  semanticSourceHash,
} from "@/lib/semantic-map-repository";
import { enqueueSemanticMapJob } from "@/lib/semantic-map-jobs";
import { processSemanticMapJob } from "@/lib/semantic-map-service";
import { getPublicRequestOrigin } from "@/lib/public-request-origin";

export const runtime = "nodejs";
export const maxDuration = 300;

const GenerateSchema = z.object({ projectId: z.string().uuid(), force: z.boolean().optional() });

function enabled(): boolean {
  return process.env.SEMANTIC_MAP_ENABLED === "true";
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!enabled()) return NextResponse.json({ error: "Semantic Map is not enabled." }, { status: 404 });
  if (getDatabaseProvider() !== "cloud-sql") {
    return NextResponse.json({ error: "Semantic Map requires Cloud SQL." }, { status: 503 });
  }
  const projectId = new URL(request.url).searchParams.get("projectId") ?? "";
  if (!z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "A valid repository ID is required." }, { status: 400 });
  }
  try {
    const [map, papers] = await Promise.all([
      getSemanticMap(user.id, projectId),
      loadSemanticPaperDocuments(user.id, projectId),
    ]);
    return NextResponse.json({ map, eligiblePapers: papers.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load semantic map.";
    return NextResponse.json({ error: message }, { status: message === "Repository not found." ? 404 : 500 });
  }
}

export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!enabled()) return NextResponse.json({ error: "Semantic Map is not enabled." }, { status: 404 });
  if (getDatabaseProvider() !== "cloud-sql") {
    return NextResponse.json({ error: "Semantic Map requires Cloud SQL." }, { status: 503 });
  }
  const parsed = GenerateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "A valid repository ID is required." }, { status: 400 });
  try {
    const papers = await loadSemanticPaperDocuments(user.id, parsed.data.projectId);
    const sourceHash = semanticSourceHash(papers);
    const existing = await getSemanticMap(user.id, parsed.data.projectId);
    if (!parsed.data.force && existing?.status === "succeeded" && !existing.stale) {
      return NextResponse.json({ map: existing, reused: true });
    }
    const mapId = await createSemanticMapJob(user.id, parsed.data.projectId, sourceHash, papers.length);
    if (process.env.SEMANTIC_MAP_INLINE_JOBS === "true") {
      await processSemanticMapJob(user.id, mapId);
      return NextResponse.json({ mapId, queued: false }, { status: 201 });
    }
    const callbackBaseUrl = getPublicRequestOrigin(request);
    const queued = await enqueueSemanticMapJob(mapId, user.id, callbackBaseUrl);
    if (!queued) {
      await failSemanticMap(user.id, mapId, new Error("Cloud Tasks could not enqueue semantic map generation."));
      return NextResponse.json({ error: "Map generation could not be queued. Try again shortly.", mapId }, { status: 503 });
    }
    return NextResponse.json({ mapId, queued: true }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to generate semantic map." }, { status: 500 });
  }
}
