import { NextResponse } from "next/server";
import { z } from "zod";
import { isRepositoryJobSecretValid } from "@/lib/repository-chat-jobs";
import { processSemanticMapJob } from "@/lib/semantic-map-service";

export const runtime = "nodejs";
export const maxDuration = 600;

const BodySchema = z.object({ mapId: z.string().uuid(), ownerUserId: z.string().uuid() });

export async function POST(request: Request) {
  if (!isRepositoryJobSecretValid(request.headers.get("x-worker-secret") ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = BodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid map job request." }, { status: 400 });
  try {
    const result = await processSemanticMapJob(parsed.data.ownerUserId, parsed.data.mapId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Semantic map job failed.", {
      mapId: parsed.data.mapId,
      ownerUserId: parsed.data.ownerUserId,
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
