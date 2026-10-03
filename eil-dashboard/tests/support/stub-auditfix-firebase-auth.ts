/*
 * firebase/auth for tests of the sign-in helpers: nothing is sent. Each reset
 * email asked for is recorded in globalThis.__auditfixResetEmails; Firebase's
 * refusal of a continue address is whatever globalThis.__auditfixRefuse
 * returns for the settings it was given.
 */
export interface RecordedResetEmail {
  email: string;
  settings?: { url?: string };
}

declare global {
  // eslint-disable-next-line no-var
  var __auditfixResetEmails: RecordedResetEmail[] | undefined;
  // eslint-disable-next-line no-var
  var __auditfixRefuse: ((settings?: { url?: string }) => string | null) | undefined;
}

export async function sendPasswordResetEmail(_auth: unknown, email: string, settings?: { url?: string }): Promise<void> {
  const refusal = globalThis.__auditfixRefuse?.(settings) ?? null;
  if (refusal) throw Object.assign(new Error(`Firebase: Error (${refusal}).`), { code: refusal });
  (globalThis.__auditfixResetEmails ??= []).push({ email, ...(settings ? { settings } : {}) });
}
