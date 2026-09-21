import { getAllowedOrigins } from "@/lib/server-env";

/**
 * Cross-origin headers for the chat endpoint.
 *
 * Firebase Hosting buffers a streamed response and applies a fixed 60-second
 * deadline, so progress frames arrive all at once and long answers are cut off.
 * Letting the browser call the Cloud Run origin directly for this one endpoint
 * avoids both, while the rest of the site keeps serving from Hosting.
 *
 * Only origins listed in APP_ALLOWED_ORIGINS are permitted, and the request is
 * authorized by a bearer token rather than a cookie, so credentials are not
 * needed and are deliberately not allowed.
 */
export function chatCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin) return {};
  const allowed = getAllowedOrigins();
  const normalized = origin.trim().replace(/\/$/, "");
  if (!allowed.includes(normalized)) return {};
  return {
    "Access-Control-Allow-Origin": normalized,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept",
    "Access-Control-Max-Age": "3600",
    // The allowed origin varies by request, so caches must key on it.
    Vary: "Origin",
  };
}

/** Applies the cross-origin headers to a response without replacing it. */
export function withChatCors(response: Response, request: Request): Response {
  const headers = chatCorsHeaders(request);
  for (const [key, value] of Object.entries(headers)) {
    response.headers.set(key, value);
  }
  return response;
}

/** Answers a CORS preflight for the chat endpoint. */
export function chatCorsPreflight(request: Request): Response {
  return new Response(null, { status: 204, headers: chatCorsHeaders(request) });
}
