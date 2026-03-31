import { NextResponse } from "next/server";
import {
  getCronSecret,
  getWorkerServiceUrl,
  getWorkerWebhookSecret,
} from "@/lib/server-env";

export const runtime = "nodejs";
export const maxDuration = 300;

function parseMaxRuns(value: string | null): number {
  const parsed = Number.parseInt(value ?? "1", 10);
  if (!Number.isFinite(parsed)) {
    return 1;
  }
  return Math.min(Math.max(parsed, 1), 5);
}

export async function GET(request: Request) {
  const expectedCronSecret = getCronSecret();
  const authHeader = request.headers.get("authorization") ?? "";

  if (!expectedCronSecret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 500 }
    );
  }

  if (authHeader !== `Bearer ${expectedCronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const workerServiceUrl = getWorkerServiceUrl();
  const workerWebhookSecret = getWorkerWebhookSecret();
  if (!workerServiceUrl || !workerWebhookSecret) {
    return NextResponse.json(
      { error: "Worker service URL or webhook secret is not configured." },
      { status: 500 }
    );
  }

  const url = new URL(request.url);
  const maxRuns = parseMaxRuns(url.searchParams.get("maxRuns"));

  try {
    const response = await fetch(`${workerServiceUrl}/process-queue`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${workerWebhookSecret}`,
      },
      body: JSON.stringify({ maxRuns }),
      cache: "no-store",
    });

    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      console.error("[cron.process-queue] worker call failed", {
        status: response.status,
        payload,
      });
      return NextResponse.json(
        {
          error: "Worker queue batch failed.",
          workerStatus: response.status,
          workerPayload: payload,
        },
        { status: response.status }
      );
    }

    console.info("[cron.process-queue] worker queue batch complete", payload);
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    console.error("[cron.process-queue] unexpected failure", {
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to contact the worker service.",
      },
      { status: 500 }
    );
  }
}
