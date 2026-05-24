import { NextResponse } from "next/server";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import {
  getPythonNodeServiceUrl,
  getWorkerServiceUrl,
  getWorkerWebhookSecret,
} from "@/lib/server-env";

export const runtime = "nodejs";

function safeHost(value: string): string {
  if (!value) {
    return "";
  }
  try {
    return new URL(value).host;
  } catch {
    return "invalid-url";
  }
}

export async function GET(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pythonNodeServiceUrl = getPythonNodeServiceUrl();
  const workerServiceUrl = getWorkerServiceUrl();
  const workerWebhookSecret = getWorkerWebhookSecret();

  return NextResponse.json({
    vercelEnv: process.env.VERCEL_ENV ?? "",
    vercelGitCommitRef: process.env.VERCEL_GIT_COMMIT_REF ?? "",
    pythonNodeServiceConfigured: Boolean(pythonNodeServiceUrl),
    pythonNodeServiceHost: safeHost(pythonNodeServiceUrl),
    workerServiceConfigured: Boolean(workerServiceUrl),
    workerServiceHost: safeHost(workerServiceUrl),
    workerWebhookSecretConfigured: Boolean(workerWebhookSecret),
    workerUsesPythonFallback:
      Boolean(workerServiceUrl) &&
      Boolean(pythonNodeServiceUrl) &&
      workerServiceUrl === pythonNodeServiceUrl,
  });
}
#