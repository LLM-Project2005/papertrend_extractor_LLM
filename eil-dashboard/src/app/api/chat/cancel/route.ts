import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { cancelRequest, isValidRequestId } from "@/lib/chat-cancel-registry";

/**
 * Stops an answer that is still running.
 *
 * The browser disconnecting does not reach the container behind the Cloud Run
 * proxy, so Stop says so explicitly rather than hoping the transport reports it.
 */
export async function POST(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { requestId?: unknown } | null;
  const requestId = body?.requestId;
  if (!isValidRequestId(requestId)) {
    return NextResponse.json({ error: "A valid requestId is required." }, { status: 400 });
  }

  // Keyed by the authenticated user, so one reader can never cancel another's
  // answer by guessing an id.
  const cancelled = cancelRequest(user.id, requestId);
  // An answer that already finished is the ordinary case, not a failure.
  return NextResponse.json({ cancelled });
}
