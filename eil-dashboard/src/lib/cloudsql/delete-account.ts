import type { PoolClient } from "pg";
import { withCloudSqlOwnerTransaction } from "@/lib/cloudsql/client";
import { deleteSelectedRuns } from "@/lib/cloudsql/permanent-delete";

/*
 * Deleting an account (Settings > Sign-in & security > Delete account,
 * 2026-11-05). One owner-scoped transaction, so a failure leaves the account
 * exactly as it was:
 *
 *  - every paper, the way "Delete permanently" takes one (permanent-delete.ts),
 *    and its file once nothing else uses it;
 *  - every repository and the organization that holds them, with their
 *    folders, Tables, maps and jobs (ON DELETE CASCADE);
 *  - every other row the account owns: chats, deep research, usage records,
 *    the Google Drive link, cached figures;
 *  - the profile, which takes the sign-in link and the invite it redeemed.
 *
 * The caller then removes the stored files and the Firebase sign-in. An admin
 * account is refused, so the last person who can make invite codes cannot
 * delete themselves by accident; another admin removes the role first.
 */

export class AccountDeleteRefused extends Error {}

export interface AccountDeleteResult {
  orphanedObjects: string[];
  /** Firebase UIDs that signed in to this account, to delete after commit. */
  firebaseUids: string[];
}

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error(`Unexpected table or column name: ${name}`);
  return name;
}

/** Tables whose rows are the account's, by the column that names it. */
async function ownedTables(client: PoolClient): Promise<Array<{ table: string; column: string }>> {
  const result = await client.query<{ table_name: string; column_name: string }>(
    `SELECT c.table_name, c.column_name
     FROM information_schema.columns c
     JOIN information_schema.tables t
       ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
       AND (c.column_name = 'owner_user_id' OR (c.table_name = 'google_drive_connections' AND c.column_name = 'user_id'))
       AND c.table_name <> 'user_profiles'
     ORDER BY c.table_name`
  );
  return result.rows.map((row) => ({ table: row.table_name, column: row.column_name }));
}

export async function deleteAccountWithin(
  client: PoolClient,
  ownerUserId: string,
  confirmEmail: string
): Promise<AccountDeleteResult> {
  const profile = await client.query<{ email: string | null; role: string | null }>(
    `SELECT email, role FROM public.user_profiles WHERE id = $1 FOR UPDATE`,
    [ownerUserId]
  );
  if (profile.rowCount === 0) throw new AccountDeleteRefused("This account was not found.");
  const { email, role } = profile.rows[0];
  if (role === "admin") {
    throw new AccountDeleteRefused("An admin account can't be deleted here. Ask another admin to remove your admin role first.");
  }
  if (!email || confirmEmail.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new AccountDeleteRefused("The email you typed doesn't match this account's email.");
  }

  const busy = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM public.ingestion_runs WHERE owner_user_id = $1 AND status IN ('queued', 'processing')`,
    [ownerUserId]
  );
  const analysing = Number(busy.rows[0]?.count ?? 0);
  if (analysing > 0) {
    throw new AccountDeleteRefused(
      `${analysing} paper${analysing === 1 ? " is" : "s are"} still being analysed. Delete the account when ${analysing === 1 ? "it has" : "they have"} finished.`
    );
  }

  const firebase = await client.query<{ external_subject: string }>(
    `SELECT external_subject FROM public.auth_identity_mappings WHERE owner_user_id = $1 AND provider = 'firebase'`,
    [ownerUserId]
  );

  const runs = await client.query<{ id: string; source_path: string | null; project_id: string | null }>(
    `SELECT r.id, r.source_path, f.project_id
     FROM public.ingestion_runs r
     LEFT JOIN public.research_folders f ON f.id = r.folder_id AND f.owner_user_id = r.owner_user_id
     WHERE r.owner_user_id = $1
     FOR UPDATE OF r`,
    [ownerUserId]
  );
  const deleted = await deleteSelectedRuns(client, ownerUserId, runs.rows);

  // Organizations take their repositories, and those their folders and
  // everything hung on them, by cascade.
  await client.query(`DELETE FROM public.workspace_organizations WHERE owner_user_id = $1`, [ownerUserId]);

  // Then whatever else the account owns. Tables refer to each other, so a
  // delete that is blocked by a row still to go is tried again on the next
  // pass, after the row it waits for has gone.
  let pending = await ownedTables(client);
  for (let pass = 0; pending.length > 0 && pass < 6; pass += 1) {
    const blocked: typeof pending = [];
    let lastError: unknown = null;
    for (const entry of pending) {
      // Names from information_schema, admitted only as plain identifiers
      // (as paper-copy.ts does); the account id is a parameter.
      const table = ident(entry.table);
      const key = ident(entry.column);
      await client.query("SAVEPOINT account_delete_table");
      try {
        await client.query(`DELETE FROM public.${table} WHERE ${key} = $1`, [ownerUserId]);
        await client.query("RELEASE SAVEPOINT account_delete_table");
      } catch (error) {
        await client.query("ROLLBACK TO SAVEPOINT account_delete_table");
        // Only a foreign key waits for another table; anything else is a real failure.
        if ((error as { code?: string } | null)?.code !== "23503") throw error;
        blocked.push(entry);
        lastError = error;
      }
    }
    if (blocked.length === pending.length) throw lastError;
    pending = blocked;
  }
  if (pending.length > 0) throw new Error(`Account rows could not be removed from: ${pending.map((entry) => entry.table).join(", ")}`);

  await client.query(`DELETE FROM public.user_profiles WHERE id = $1`, [ownerUserId]);

  return {
    orphanedObjects: deleted.orphanedObjects,
    firebaseUids: firebase.rows.map((row) => row.external_subject),
  };
}

export function deleteAccount(ownerUserId: string, confirmEmail: string): Promise<AccountDeleteResult> {
  return withCloudSqlOwnerTransaction(ownerUserId, (client) => deleteAccountWithin(client, ownerUserId, confirmEmail));
}
