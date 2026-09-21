import assert from "node:assert/strict";
import test from "node:test";
import { chatCorsHeaders, chatCorsPreflight } from "../src/lib/chat-cors";

const ALLOWED = "https://research-trend-analysis.web.app";
const DIRECT = "https://papertrend-web-production-javhavgdsq-as.a.run.app";

function withAllowedOrigins<T>(value: string, run: () => T): T {
  const previous = process.env.APP_ALLOWED_ORIGINS;
  process.env.APP_ALLOWED_ORIGINS = value;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.APP_ALLOWED_ORIGINS;
    else process.env.APP_ALLOWED_ORIGINS = previous;
  }
}

function request(origin?: string): Request {
  return new Request(`${DIRECT}/api/chat`, {
    method: "POST",
    headers: origin ? { Origin: origin } : {},
  });
}

test("an allowed origin receives cross-origin headers", () => {
  withAllowedOrigins(`${DIRECT};${ALLOWED}`, () => {
    const headers = chatCorsHeaders(request(ALLOWED));
    assert.equal(headers["Access-Control-Allow-Origin"], ALLOWED);
    assert.match(headers["Access-Control-Allow-Methods"], /POST/);
    assert.match(headers["Access-Control-Allow-Headers"], /Authorization/);
    assert.match(headers["Access-Control-Allow-Headers"], /Accept/);
  });
});

test("caches are told the response varies by origin", () => {
  withAllowedOrigins(ALLOWED, () => {
    assert.equal(chatCorsHeaders(request(ALLOWED)).Vary, "Origin");
  });
});

test("an unlisted origin receives no cross-origin headers", () => {
  withAllowedOrigins(ALLOWED, () => {
    assert.deepEqual(chatCorsHeaders(request("https://attacker.example.com")), {});
  });
});

test("a same-origin request needs no cross-origin headers", () => {
  withAllowedOrigins(ALLOWED, () => {
    assert.deepEqual(chatCorsHeaders(request()), {});
  });
});

test("a trailing slash does not defeat the allowlist", () => {
  withAllowedOrigins(`${ALLOWED}/`, () => {
    assert.equal(chatCorsHeaders(request(ALLOWED))["Access-Control-Allow-Origin"], ALLOWED);
  });
});

test("credentials are never allowed, since the token is a bearer header", () => {
  withAllowedOrigins(ALLOWED, () => {
    const headers = chatCorsHeaders(request(ALLOWED));
    assert.equal(headers["Access-Control-Allow-Credentials"], undefined);
  });
});

test("the preflight answers 204 with the headers", () => {
  withAllowedOrigins(ALLOWED, () => {
    const response = chatCorsPreflight(request(ALLOWED));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), ALLOWED);
  });
});

test("a preflight from an unlisted origin is answered without permission", () => {
  withAllowedOrigins(ALLOWED, () => {
    const response = chatCorsPreflight(request("https://attacker.example.com"));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  });
});

test("an empty allowlist permits nothing", () => {
  withAllowedOrigins("", () => {
    // Falls back to NEXT_PUBLIC_SITE_URL, which is not the attacker origin.
    assert.equal(
      chatCorsHeaders(request("https://attacker.example.com"))["Access-Control-Allow-Origin"],
      undefined
    );
  });
});
