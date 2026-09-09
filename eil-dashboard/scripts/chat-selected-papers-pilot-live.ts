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

async function json(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(payload.error ?? `Request failed with ${response.status}.`));
  return payload;
}

async function main() {
  const baseUrl = required("PAPER_TREND_PILOT_URL").replace(/\/$/, "");
  const projectId = required("PAPER_TREND_TEST_PROJECT_ID");
  const token = await firebaseIdToken();
  const headers = { Authorization: `Bearer ${token}` };
  const library = await json(await fetch(`${baseUrl}/api/workspace/library?projectId=${encodeURIComponent(projectId)}`, { headers }));
  const runs = (Array.isArray(library.runs) ? library.runs : [])
    .filter((run): run is Record<string, unknown> => Boolean(run && typeof run === "object" && (run as { status?: unknown }).status === "succeeded"))
    .slice(0, 3);
  if (runs.length !== 3) throw new Error("The pilot project needs at least three successful papers.");
  const runIds = runs.map((run) => String(run.id));
  const response = await json(await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Compare these 3 papers, explaining their shared themes, important differences, methods, findings, and limitations.",
      messages: [{ role: "user", content: "Compare these 3 papers." }],
      projectId,
      folderId: "all",
      selectedRunIds: runIds,
      knowledgeScope: { kind: "selected_papers", projectId, folderId: "all", runIds },
      attachments: runs.map((run) => ({
        name: String(run.display_name ?? run.source_filename ?? run.id),
        runId: String(run.id),
        size: String(run.file_size_bytes ?? "0"),
        status: "succeeded",
      })),
      chatMode: "normal",
      action: "message",
      toolMode: "auto",
    }),
  }));
  if (response.groundingMode === "repository_unavailable") {
    throw new Error(`Selected-paper knowledge scope failed (request ${String(response.requestId ?? "unknown")}).`);
  }
  const answer = String(response.answer ?? "").trim();
  if (!answer || answer.includes("could not access the selected Papertrend knowledge scope")) {
    throw new Error("Pilot did not return a grounded selected-paper answer.");
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    requestId: response.requestId,
    groundingMode: response.groundingMode,
    selectedPapers: runIds.length,
    answerCharacters: answer.length,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
