import type { PoolClient } from "pg";
import { ACCESS_REQUEST_RETENTION_DAYS, type AccessRequestInput, type AccessRequestStatus } from "@/lib/access-requests";
import { withCloudSqlServiceTransaction } from "@/lib/cloudsql/client";
import { insertInviteCode, type InviteCodeSummary } from "@/lib/cloudsql/invite-repository";
import { ACCESS_REQUEST_INVITE_DAYS } from "@/lib/access-request-limits";
import { inviteStatus, type InviteStatus } from "@/lib/invite-codes";

/*
 * Access requests (cloudsql/20261002_access_requests.sql). Each function's
 * body takes the caller's transaction, so the SQL runs as-is in the PGlite
 * tests; the exported wrappers open a service transaction (there is no owner:
 * the person asking has no account).
 */

type Client = Pick<PoolClient, "query">;

export interface AccessRequestSummary {
  id: string;
  name: string;
  email: string;
  affiliation: string;
  intendedUse: string;
  status: AccessRequestStatus;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  /** The code sent in answer, once invited: whether it has been used yet. */
  inviteStatus: InviteStatus | null;
}

interface AccessRequestRow {
  id: string;
  name: string;
  email: string;
  affiliation: string;
  intended_use: string;
  status: AccessRequestStatus;
  created_at: string | Date;
  updated_at: string | Date;
  reviewed_at: string | Date | null;
  invite_revoked_at: string | null;
  invite_expires_at: string | Date | null;
  invite_use_count: number | null;
  invite_max_uses: number | null;
}

/** A request that was already answered, or no longer exists. */
export class AccessRequestStateError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409
  ) {
    super(message);
    this.name = "AccessRequestStateError";
  }
}

const SUMMARY_COLUMNS = `r.id, r.name, r.email, r.affiliation, r.intended_use, r.status,
  r.created_at, r.updated_at, r.reviewed_at,
  c.revoked_at AS invite_revoked_at, c.expires_at AS invite_expires_at,
  c.use_count AS invite_use_count, c.max_uses AS invite_max_uses`;

/** The driver returns timestamps as Dates. */
function iso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toSummary(row: AccessRequestRow): AccessRequestSummary {
  const invite =
    row.invite_expires_at !== null && row.invite_use_count !== null && row.invite_max_uses !== null
      ? inviteStatus({
          revoked_at: row.invite_revoked_at,
          expires_at: iso(row.invite_expires_at),
          use_count: row.invite_use_count,
          max_uses: row.invite_max_uses,
        })
      : null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    affiliation: row.affiliation,
    intendedUse: row.intended_use,
    status: row.status,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    reviewedAt: row.reviewed_at === null ? null : iso(row.reviewed_at),
    inviteStatus: invite,
  };
}

/** Deletes every request past the retention period: they are personal data from people with no account. */
export async function purgeExpiredAccessRequests(client: Client): Promise<number> {
  const result = await client.query(
    `DELETE FROM public.access_requests WHERE created_at < now() - make_interval(days => $1::int)`,
    [ACCESS_REQUEST_RETENTION_DAYS]
  );
  return result.rowCount ?? 0;
}

/**
 * Stores a request. An email with a request still waiting has that request
 * brought up to date instead of a second one added.
 */
export async function submitAccessRequestIn(client: Client, input: AccessRequestInput): Promise<void> {
  await purgeExpiredAccessRequests(client);
  await client.query(
    `INSERT INTO public.access_requests (name, email, affiliation, intended_use)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) WHERE status = 'pending'
     DO UPDATE SET name = EXCLUDED.name, affiliation = EXCLUDED.affiliation,
                   intended_use = EXCLUDED.intended_use, updated_at = now()`,
    [input.name, input.email, input.affiliation, input.intendedUse]
  );
}

/** Waiting requests first, then the newest; with the state of any code sent. */
export async function listAccessRequestsIn(client: Client): Promise<AccessRequestSummary[]> {
  await purgeExpiredAccessRequests(client);
  const result = await client.query<AccessRequestRow>(
    `SELECT ${SUMMARY_COLUMNS}
     FROM public.access_requests r
     LEFT JOIN public.invite_codes c ON c.id = r.invite_code_id
     ORDER BY (r.status = 'pending') DESC, r.updated_at DESC
     LIMIT 500`
  );
  return result.rows.map(toSummary);
}

async function pendingRequest(client: Client, requestId: string): Promise<AccessRequestRow> {
  const found = await client.query<AccessRequestRow>(
    `SELECT ${SUMMARY_COLUMNS}
     FROM public.access_requests r
     LEFT JOIN public.invite_codes c ON c.id = r.invite_code_id
     WHERE r.id = $1
     FOR UPDATE OF r`,
    [requestId]
  );
  const row = found.rows[0];
  if (!row) throw new AccessRequestStateError("That request no longer exists.", 404);
  if (row.status !== "pending") throw new AccessRequestStateError("That request was already answered.", 409);
  return row;
}

async function reloaded(client: Client, requestId: string): Promise<AccessRequestSummary> {
  const result = await client.query<AccessRequestRow>(
    `SELECT ${SUMMARY_COLUMNS}
     FROM public.access_requests r
     LEFT JOIN public.invite_codes c ON c.id = r.invite_code_id
     WHERE r.id = $1`,
    [requestId]
  );
  return toSummary(result.rows[0]);
}

/**
 * Answers a waiting request with a one-use code bound to its email, in one
 * transaction: the code and the request's new state land together. The code
 * is returned once, for the admin to send.
 */
export async function inviteFromAccessRequestIn(
  client: Client,
  input: { requestId: string; adminId: string; expiresInDays?: number }
): Promise<{ code: string; invite: InviteCodeSummary; request: AccessRequestSummary }> {
  const row = await pendingRequest(client, input.requestId);
  const { code, invite } = await insertInviteCode(client, {
    createdBy: input.adminId,
    label: `Access request: ${row.name}`.slice(0, 80),
    boundEmail: row.email,
    maxUses: 1,
    expiresInDays: input.expiresInDays ?? ACCESS_REQUEST_INVITE_DAYS,
  });
  await client.query(
    `UPDATE public.access_requests
     SET status = 'invited', invite_code_id = $2, reviewed_at = now(), reviewed_by = $3, updated_at = now()
     WHERE id = $1`,
    [input.requestId, invite.id, input.adminId]
  );
  return { code, invite, request: await reloaded(client, input.requestId) };
}

export async function declineAccessRequestIn(
  client: Client,
  input: { requestId: string; adminId: string }
): Promise<AccessRequestSummary> {
  await pendingRequest(client, input.requestId);
  await client.query(
    `UPDATE public.access_requests
     SET status = 'declined', reviewed_at = now(), reviewed_by = $2, updated_at = now()
     WHERE id = $1`,
    [input.requestId, input.adminId]
  );
  return reloaded(client, input.requestId);
}

/** Removes a request at once, as a person may ask under the privacy policy. */
export async function deleteAccessRequestIn(client: Client, requestId: string): Promise<boolean> {
  const result = await client.query(`DELETE FROM public.access_requests WHERE id = $1`, [requestId]);
  return (result.rowCount ?? 0) > 0;
}

export const submitAccessRequest = (input: AccessRequestInput) =>
  withCloudSqlServiceTransaction((client) => submitAccessRequestIn(client, input));
export const listAccessRequests = () => withCloudSqlServiceTransaction((client) => listAccessRequestsIn(client));
export const inviteFromAccessRequest = (input: { requestId: string; adminId: string; expiresInDays?: number }) =>
  withCloudSqlServiceTransaction((client) => inviteFromAccessRequestIn(client, input));
export const declineAccessRequest = (input: { requestId: string; adminId: string }) =>
  withCloudSqlServiceTransaction((client) => declineAccessRequestIn(client, input));
export const deleteAccessRequest = (requestId: string) =>
  withCloudSqlServiceTransaction((client) => deleteAccessRequestIn(client, requestId));
