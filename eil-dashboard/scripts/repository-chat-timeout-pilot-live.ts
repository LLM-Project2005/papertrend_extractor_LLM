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
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(required("NEXT_PUBLIC_FIREBASE_API_KEY"))}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    }
  );
  const payload = await response.json() as { idToken?: string; error?: { message?: string } };
  if (!response.ok || !payload.idToken) {
    throw new Error(payload.error?.message ?? "Firebase token exchange failed.");
  }
  return payload.idToken;
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(payload.error ?? `Request failed with ${response.status}.`));
  }
  return payload;
}

async function main() {
  if (!process.argv.includes("--apply")) {
    throw new Error("This test creates and deletes a pilot chat thread. Pass --apply to continue.");
  }
  const baseUrl = required("PAPER_TREND_PILOT_URL").replace(/\/$/, "");
  const projectId = required("PAPER_TREND_TEST_PROJECT_ID");
  const token = await firebaseIdToken();
  const headers = { Authorization: `Bearer ${token}` };
  let threadId = "";

  try {
    const startedAt = Date.now();
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Write a comprehensive synthesis of the themes, methods, findings, disagreements, limitations, and research gaps across every analyzed paper in this repository. Use the complete repository and cite the evidence used.",
        messages: [{ role: "user", content: "Synthesize every analyzed paper in this repository." }],
        projectId,
        folderId: "all",
        selectedRunIds: [],
        knowledgeScope: { kind: "project", projectId },
        attachments: [],
        chatMode: "normal",
        action: "message",
        toolMode: "auto",
      }),
    });
    const elapsedMs = Date.now() - startedAt;
    const queued = await readJson(response);
    if (response.status !== 202) {
      throw new Error(`Expected a durable 202 response, received ${response.status}.`);
    }
    if (elapsedMs >= 55_000) {
      throw new Error(`Initial handoff took ${elapsedMs}ms, exceeding the Firebase-safe budget.`);
    }
    const jobId = String(queued.jobId ?? "");
    threadId = String((queued.thread as { id?: unknown } | undefined)?.id ?? "");
    if (!jobId || !threadId) throw new Error("Queued response omitted its job or thread ID.");

    let terminalStatus = "";
    for (let attempt = 0; attempt < 180; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, 2_000 + attempt * 250)));
      const payload = await readJson(await fetch(
        `${baseUrl}/api/chat/jobs/${encodeURIComponent(jobId)}`,
        { headers }
      ));
      const job = payload.job as { status?: unknown; errorMessage?: unknown } | undefined;
      terminalStatus = String(job?.status ?? "");
      if (terminalStatus === "failed" || terminalStatus === "canceled") {
        throw new Error(String(job?.errorMessage ?? `Repository job ${terminalStatus}.`));
      }
      if (terminalStatus === "succeeded") break;
    }
    if (terminalStatus !== "succeeded") throw new Error("Timed out waiting for the repository job.");

    const detail = await readJson(await fetch(
      `${baseUrl}/api/chat/threads/${encodeURIComponent(threadId)}`,
      { headers }
    ));
    const messages = Array.isArray(detail.messages) ? detail.messages as Array<Record<string, unknown>> : [];
    const resultMessages = messages.filter((message) => {
      const metadata = message.metadata as Record<string, unknown> | undefined;
      return metadata?.repositoryJobId === jobId && message.role === "assistant";
    });
    if (resultMessages.length !== 1) {
      throw new Error(`Expected exactly one persisted assistant result, found ${resultMessages.length}.`);
    }
    const result = resultMessages[0];
    const metadata = result.metadata as Record<string, unknown> | undefined;
    const content = String(result.content ?? "").trim();
    if (metadata?.repositoryJobStatus !== "succeeded" || content.length < 200) {
      throw new Error("The durable result was not fully persisted in the conversation.");
    }

    const reopened = await readJson(await fetch(
      `${baseUrl}/api/chat/threads/${encodeURIComponent(threadId)}`,
      { headers }
    ));
    const reopenedMessages = Array.isArray(reopened.messages) ? reopened.messages as Array<Record<string, unknown>> : [];
    const reopenedResults = reopenedMessages.filter((message) => {
      const reopenedMetadata = message.metadata as Record<string, unknown> | undefined;
      return reopenedMetadata?.repositoryJobId === jobId && message.role === "assistant";
    });
    if (reopenedResults.length !== 1) throw new Error("Reopening the thread did not recover exactly one result.");

    process.stdout.write(`${JSON.stringify({
      ok: true,
      initialStatus: response.status,
      initialElapsedMs: elapsedMs,
      jobId,
      terminalStatus,
      persistedResults: resultMessages.length,
      answerCharacters: content.length,
    }, null, 2)}\n`);
  } finally {
    if (threadId) {
      await fetch(`${baseUrl}/api/chat/threads/${encodeURIComponent(threadId)}`, {
        method: "DELETE",
        headers,
      }).catch(() => undefined);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
