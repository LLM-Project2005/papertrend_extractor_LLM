/*
 * Which deployment this server is, and who may use the pilot (docs/32, 1.1).
 *
 * The pilot runs the test branch against the production database. Two things
 * keep test code away from real users' work:
 *
 *  - every run records the deployment that queued it, and each deployment's
 *    worker claims, recovers and re-queues only its own runs;
 *  - the pilot admits only the owner's accounts, so nobody else's papers can
 *    be touched by code that has not reached production yet.
 */

export type Deployment = "production" | "pilot";

/** The key in ingestion_runs.input_payload that records the queuing deployment. */
export const DEPLOYMENT_KEY = "deployment";

export function deploymentEnv(): Deployment {
  return String(process.env.DEPLOYMENT_ENV ?? "").trim().toLowerCase() === "pilot" ? "pilot" : "production";
}

/** Emails admitted to the pilot, besides admin accounts. */
export function pilotAllowedEmails(raw: string | undefined = process.env.PILOT_ALLOWED_EMAILS): string[] {
  return String(raw ?? "")
    .split(/[,\s]+/)
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.includes("@"));
}

/**
 * Whether this account may use this deployment. Production admits everyone
 * (sign-up rules apply as usual); the pilot admits listed emails and admins.
 */
export function deploymentAdmits(input: { email: string | null; role?: string | null }, deployment: Deployment = deploymentEnv()): boolean {
  if (deployment === "production") return true;
  if (input.role === "admin" || input.role === "superuser") return true;
  const email = String(input.email ?? "").trim().toLowerCase();
  return Boolean(email) && pilotAllowedEmails().includes(email);
}

export const PILOT_RESTRICTED_MESSAGE =
  "This is Papertrend's test deployment, open to the project owner only. Use the main Papertrend site instead.";
