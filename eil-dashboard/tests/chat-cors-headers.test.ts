import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

function read(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), "utf8");
}

/**
 * These guard a failure that unit tests and server-side probes both miss: the
 * browser refuses the request before it is ever sent. Every live probe in this
 * work spoke to Cloud Run directly, which does no preflight, so a missing CORS
 * entry looked healthy from the outside while the real UI would have been dead.
 */

/** Custom headers the chat client sends, which a preflight must therefore allow. */
function customHeadersSentByClient(): string[] {
  const client = read("components/chat/ChatClient.tsx");
  // Matches `"X-Thing": value` header entries in the fetch calls.
  const found = new Set<string>();
  const pattern = new RegExp('"(X-[A-Za-z0-9-]+)"\s*:', "g");
  for (const match of client.matchAll(pattern)) found.add(match[1]);
  return [...found];
}

test("every custom header the client sends is allowed by the preflight", () => {
  // A custom header missing from Access-Control-Allow-Headers fails the
  // preflight, which blocks the whole request rather than just the header.
  const cors = read("lib/chat-cors.ts");
  const allowLine = cors
    .split("\n")
    .find((line) => line.includes("Access-Control-Allow-Headers"));
  assert.ok(allowLine, "no Access-Control-Allow-Headers entry found");
  const custom = customHeadersSentByClient();
  assert.ok(custom.length > 0, "expected the client to send at least one custom header");
  for (const header of custom) {
    assert.ok(
      allowLine!.toLowerCase().includes(header.toLowerCase()),
      `${header} is sent by the client but not allowed by the preflight`
    );
  }
});

test("the header that names the request for Stop is allowed", () => {
  const cors = read("lib/chat-cors.ts");
  assert.match(cors, /X-Chat-Request-Id/);
});

test("the cancel route answers its own preflight", () => {
  // Without an OPTIONS handler the browser gets a bare 204 with no CORS headers
  // and blocks Stop, leaving the answer running.
  const route = read("app/api/chat/cancel/route.ts");
  assert.match(route, /export async function OPTIONS\(request: Request\)/);
  assert.match(route, /chatCorsPreflight\(request\)/);
});

test("every cancel response carries the cross-origin headers", () => {
  const route = read("app/api/chat/cancel/route.ts");
  const returns = [...route.matchAll(/return (?!withChatCors|chatCorsPreflight)(\w+)/g)];
  assert.deepEqual(
    returns.map((match) => match[1]),
    [],
    "a response returned without withChatCors would be blocked by the browser"
  );
});

test("Stop reaches the same origin that is running the answer", () => {
  // The chat request goes to the direct Cloud Run URL to avoid the Hosting
  // deadline. A relative cancel path would go to Hosting instead - a different
  // container, whose registry has never heard of this request.
  const client = read("components/chat/ChatClient.tsx");
  assert.match(client, /fetch\(chatEndpoint\("\/api\/chat\/cancel"\)/);
  assert.equal(
    client.includes('fetch("/api/chat/cancel"'),
    false,
    "the cancel call must not use a relative path"
  );
});

test("the chat request itself still goes through the same helper", () => {
  const client = read("components/chat/ChatClient.tsx");
  assert.match(client, /fetch\(chatEndpoint\(\)/);
});
