import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "papertrend-web",
    revision: process.env.K_REVISION ?? null,
  });
}
