import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

async function firebaseIdToken(): Promise<string> {
  const projectId = required("FIREBASE_PROJECT_ID");
  if (getApps().length === 0) {
    initializeApp({ credential: cert({
      projectId,
      clientEmail: required("FIREBASE_CLIENT_EMAIL"),
      privateKey: required("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n"),
    }) });
  }
  const customToken = await getAuth().createCustomToken(required("FIREBASE_TEST_UID"));
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(required("NEXT_PUBLIC_FIREBASE_API_KEY"))}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: customToken, returnSecureToken: true }),
  });
  const payload = await response.json() as { idToken?: string; error?: { message?: string } };
  if (!response.ok || !payload.idToken) throw new Error(payload.error?.message ?? "Firebase token exchange failed.");
  return payload.idToken;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? `Request failed with ${response.status}.`));
  return payload;
}

async function main() {
  if (!process.argv.includes("--apply")) {
    throw new Error("This test creates an idempotent pilot map revision. Pass --apply to continue.");
  }
  const baseUrl = required("PAPER_TREND_PILOT_URL").replace(/\/$/, "");
  const projectId = required("PAPER_TREND_TEST_PROJECT_ID");
  const token = await firebaseIdToken();
  const headers = { Authorization: `Bearer ${token}` };
  const initial = await readJson(await fetch(`${baseUrl}/api/workspace/semantic-map?projectId=${encodeURIComponent(projectId)}`, { headers }));
  const created = await readJson(await fetch(`${baseUrl}/api/workspace/semantic-map`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, force: true }),
  }));
  const mapId = String(created.mapId ?? "");
  if (!mapId) throw new Error("Pilot generation did not return a map job ID.");
  let completed: Record<string, unknown> | null = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const job = await readJson(await fetch(`${baseUrl}/api/workspace/semantic-map/jobs/${encodeURIComponent(mapId)}`, { headers }));
    const map = job.map as Record<string, unknown> | undefined;
    if (map?.status === "failed" || map?.status === "canceled") throw new Error(String(map.error ?? `Map job ${map.status}.`));
    if (map?.status === "succeeded") {
      completed = map;
      break;
    }
  }
  if (!completed) throw new Error("Timed out waiting for the pilot map job.");
  const points = Array.isArray(completed.points) ? completed.points : [];
  if (points.length === 0 || new Set(points.map((point) => String((point as { paperId?: string }).paperId))).size !== points.length) {
    throw new Error("Pilot response did not contain each mapped paper exactly once.");
  }
  const serialized = JSON.stringify(completed);
  if (serialized.includes("embedding") || serialized.includes("documentText")) throw new Error("Pilot API exposed private semantic input.");
  process.stdout.write(`${JSON.stringify({
    ok: true,
    initialMapAvailable: Boolean(initial.map),
    mapId,
    status: completed.status,
    mappedPapers: points.length,
    stale: completed.stale,
    projection: (completed.projection as { algorithm?: string } | undefined)?.algorithm,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
