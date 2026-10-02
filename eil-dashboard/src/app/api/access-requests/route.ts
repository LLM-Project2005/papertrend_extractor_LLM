import { NextResponse } from "next/server";
import {
  ACCESS_REQUEST_INVALID,
  ACCESS_REQUEST_MAX_BYTES,
  ACCESS_REQUEST_RECEIVED,
  parseAccessRequest,
} from "@/lib/access-requests";
import { submitAccessRequest } from "@/lib/cloudsql/access-request-repository";
import { assertAccessRequestRateLimit, GuardError } from "@/lib/security-guards";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * Public: someone without an account asks for an invite (docs/32, 4.1). Every
 * accepted request gets the same reply, whether or not the email has asked
 * before, and nothing about the request is logged.
 */
export async function POST(request: Request) {
  if (getDatabaseProvider() !== "cloud-sql") {
    return NextResponse.json({ error: "Requests can't be taken here." }, { status: 404, headers: NO_STORE });
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > ACCESS_REQUEST_MAX_BYTES) {
    return NextResponse.json({ error: ACCESS_REQUEST_INVALID }, { status: 413, headers: NO_STORE });
  }
  const text = await request.text().catch(() => "");
  if (text.length > ACCESS_REQUEST_MAX_BYTES) {
    return NextResponse.json({ error: ACCESS_REQUEST_INVALID }, { status: 413, headers: NO_STORE });
  }
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = null;
  }
  const parsed = parseAccessRequest(body);
  if (parsed.kind === "invalid") {
    return NextResponse.json({ error: ACCESS_REQUEST_INVALID }, { status: 400, headers: NO_STORE });
  }

  try {
    const email = parsed.kind === "request" ? parsed.request.email : "bot";
    await assertAccessRequestRateLimit(request, email);
    if (parsed.kind === "request") {
      await submitAccessRequest(parsed.request);
      // No personal data: a log-based count for the owner's alert.
      console.info("access_request_received");
    }
    return NextResponse.json({ message: ACCESS_REQUEST_RECEIVED }, { status: 202, headers: NO_STORE });
  } catch (error) {
    if (error instanceof GuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    }
    console.error("Storing an access request failed.", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return NextResponse.json(
      { error: "Your request couldn't be saved right now. Please try again in a few minutes." },
      { status: 503, headers: NO_STORE }
    );
  }
}
