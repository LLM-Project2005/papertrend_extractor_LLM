import { OAuth2Client } from "google-auth-library";

/*
 * Background jobs are queued as Cloud Tasks that call back into this service.
 * Each task carries a Google-signed OIDC identity token for this service's own
 * runtime account, and the callback routes accept only such a token: signed by
 * Google, issued to that exact account, for this service's address.
 *
 * They used to carry the shared worker secret in a header instead. Anyone who
 * obtained it - from a task's details, from another service holding the same
 * secret, from a log - could drive job processing for any owner. A token is
 * minted per task by Google and cannot be replayed at another audience.
 */

const METADATA_EMAIL_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email";

let runtimeEmail: Promise<string | null> | null = null;

/** This service's runtime service account, from the metadata server (cached). */
export function getRuntimeServiceAccountEmail(): Promise<string | null> {
  const configured = process.env.TASKS_OIDC_SERVICE_ACCOUNT?.trim();
  if (configured) return Promise.resolve(configured);
  if (!runtimeEmail) {
    runtimeEmail = fetch(METADATA_EMAIL_URL, { headers: { "Metadata-Flavor": "Google" } })
      .then(async (response) => (response.ok ? (await response.text()).trim() || null : null))
      .catch(() => null);
    // A failed lookup is not cached, so the next call tries again.
    void runtimeEmail.then((email) => {
      if (!email) runtimeEmail = null;
    });
  }
  return runtimeEmail;
}

/** The audience every task token is minted for and checked against. */
export function getTaskAudience(): string | null {
  const configured = process.env.APP_PUBLIC_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (!configured) return null;
  try {
    return new URL(configured).origin;
  } catch {
    return null;
  }
}

/** The oidcToken block for a Cloud Tasks httpRequest, or null off Cloud Run. */
export async function taskOidcToken(): Promise<{ serviceAccountEmail: string; audience: string } | null> {
  const serviceAccountEmail = await getRuntimeServiceAccountEmail();
  const audience = getTaskAudience();
  if (!serviceAccountEmail || !audience) return null;
  return { serviceAccountEmail, audience };
}

const verifier = new OAuth2Client();

/**
 * True only for a request from one of this service's own Cloud Tasks: a
 * Google-signed ID token for this service's address, issued to this service's
 * runtime account, with a verified email.
 */
export async function isVerifiedTaskCaller(request: Request): Promise<boolean> {
  const expectedEmail = await getRuntimeServiceAccountEmail();
  return Boolean(expectedEmail) && verifiedCaller(request, [expectedEmail!]);
}

/**
 * The analysis worker's accounts, allowed to call the few routes it needs -
 * today only search indexing. Set by the deploy (WORKER_CALLER_SERVICE_ACCOUNTS);
 * on the pilot the worker runs as this service's own account.
 */
export function workerCallerAccounts(raw = process.env.WORKER_CALLER_SERVICE_ACCOUNTS): string[] {
  return String(raw ?? "")
    .split(/[,;\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.endsWith(".gserviceaccount.com"));
}

/** A request from this service's own tasks, or from the analysis worker. */
export async function isVerifiedServiceCaller(request: Request): Promise<boolean> {
  const own = await getRuntimeServiceAccountEmail();
  return verifiedCaller(request, [...(own ? [own] : []), ...workerCallerAccounts()]);
}

async function verifiedCaller(request: Request, allowedEmails: string[]): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) return false;
  const audience = getTaskAudience();
  const allowed = new Set(allowedEmails.map((email) => email.toLowerCase()));
  if (!audience || allowed.size === 0) return false;
  try {
    const ticket = await verifier.verifyIdToken({ idToken: match[1], audience });
    const payload = ticket.getPayload();
    return Boolean(
      payload &&
        payload.email_verified === true &&
        payload.email &&
        allowed.has(payload.email.toLowerCase()) &&
        (payload.iss === "https://accounts.google.com" || payload.iss === "accounts.google.com")
    );
  } catch {
    return false;
  }
}
