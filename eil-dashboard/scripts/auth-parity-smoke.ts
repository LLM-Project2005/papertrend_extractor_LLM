type JsonBody = unknown;

type ResponseResult = {
  status: number;
  body: JsonBody;
};

const baseUrl = (process.env.AUTH_PARITY_BASE_URL ?? "").trim().replace(/\/$/, "");
const tokenA = (process.env.AUTH_PARITY_TOKEN_A ?? "").trim();
const tokenB = (process.env.AUTH_PARITY_TOKEN_B ?? "").trim();
const ownerA = (process.env.AUTH_PARITY_OWNER_A ?? "").trim();
const runIdA = (process.env.AUTH_PARITY_RUN_ID_A ?? "").trim();

if (!baseUrl || !tokenA) {
  console.error(
    "Set AUTH_PARITY_BASE_URL and AUTH_PARITY_TOKEN_A before running the auth parity smoke test."
  );
  process.exit(1);
}

async function requestJson(path: string, token?: string): Promise<ResponseResult> {
  const headers = new Headers({ Accept: "application/json" });
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${baseUrl}${path}`, { headers });
  const text = await response.text();
  let body: JsonBody = null;

  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text.slice(0, 240);
  }

  return { status: response.status, body };
}

function bodyText(body: JsonBody): string {
  return typeof body === "string" ? body : JSON.stringify(body);
}

function expectStatus(label: string, result: ResponseResult, expected: number[]): void {
  if (!expected.includes(result.status)) {
    throw new Error(`${label}: expected ${expected.join(" or ")}, received ${result.status}`);
  }
  console.log(`PASS ${label} (${result.status})`);
}

function expectOwnerId(label: string, result: ResponseResult): string {
  expectStatus(label, result, [200]);
  if (!result.body || typeof result.body !== "object" || !("ownerUserId" in result.body)) {
    throw new Error(`${label}: response did not contain an ownerUserId.`);
  }
  const value = (result.body as { ownerUserId?: unknown }).ownerUserId;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}: ownerUserId was empty.`);
  }
  return value;
}

function expectDoesNotContainOwner(label: string, result: ResponseResult, ownerId: string): void {
  if (bodyText(result.body).includes(ownerId)) {
    throw new Error(`${label}: response contained another user's owner ID.`);
  }
  console.log(`PASS ${label} (no cross-user owner ID) `);
}

async function main(): Promise<void> {
  const unauthenticatedRoutes = [
    "/api/auth/profile",
    "/api/workspace/projects",
    "/api/workspace/folders",
    "/api/workspace/library",
    "/api/chat/threads",
  ];

  for (const path of unauthenticatedRoutes) {
    const result = await requestJson(path);
    expectStatus(`unauthenticated ${path}`, result, [401]);
  }

  const profileA = await requestJson("/api/auth/profile", tokenA);
  const resolvedOwnerA = expectOwnerId("mapped Firebase user A profile", profileA);
  const expectedOwnerA = ownerA || resolvedOwnerA;

  for (const path of [
    "/api/workspace/projects",
    "/api/workspace/folders",
    "/api/workspace/library",
    "/api/chat/threads",
  ]) {
    const result = await requestJson(path, tokenA);
    expectStatus(`mapped Firebase user A ${path}`, result, [200]);
  }

  const invalidToken = await requestJson("/api/auth/profile", "invalid-auth-parity-token");
  expectStatus("invalid Firebase token", invalidToken, [401]);

  if (runIdA) {
    if (!tokenB) {
      throw new Error("AUTH_PARITY_RUN_ID_A requires AUTH_PARITY_TOKEN_B for isolation testing.");
    }
    const forbiddenPaper = await requestJson(`/api/workspace/library/${encodeURIComponent(runIdA)}`, tokenB);
    expectStatus("user B cannot open user A's paper", forbiddenPaper, [403, 404]);
  }

  if (tokenB) {
    const profileB = await requestJson("/api/auth/profile", tokenB);
    const resolvedOwnerB = expectOwnerId("mapped Firebase user B profile", profileB);
    if (resolvedOwnerB === expectedOwnerA) {
      throw new Error("Users A and B resolved to the same Papertrend owner ID.");
    }

    for (const path of [
      "/api/workspace/projects",
      "/api/workspace/folders",
      "/api/workspace/library",
      "/api/chat/threads",
    ]) {
      const result = await requestJson(path, tokenB);
      expectStatus(`mapped Firebase user B ${path}`, result, [200]);
      expectDoesNotContainOwner(`user B ${path}`, result, expectedOwnerA);
    }
  }

  console.log("Firebase auth parity smoke test completed successfully.");
}

main().catch((error) => {
  console.error(`FAIL ${error instanceof Error ? error.message : "Unknown auth parity failure"}`);
  process.exitCode = 1;
});
