/*
 * firebase/auth for tests of adding a password to a Google account: nothing is
 * sent. Every call is recorded in globalThis.__addPasswordCalls; the first link
 * attempts fail with the codes in globalThis.__addPasswordLinkErrors, in order.
 */
declare global {
  // eslint-disable-next-line no-var
  var __addPasswordCalls: string[] | undefined;
  // eslint-disable-next-line no-var
  var __addPasswordLinkErrors: string[] | undefined;
}

const calls = () => (globalThis.__addPasswordCalls ??= []);

export const EmailAuthProvider = {
  credential(email: string, password: string) {
    return { providerId: "password", email, password };
  },
};

export class GoogleAuthProvider {
  params: Record<string, string> = {};
  setCustomParameters(params: Record<string, string>) {
    this.params = params;
  }
}

export async function linkWithCredential(user: { uid: string }, credential: { providerId: string; email: string }) {
  const code = globalThis.__addPasswordLinkErrors?.shift();
  calls().push(`link:${user.uid}:${credential.providerId}:${credential.email}`);
  if (code) throw Object.assign(new Error(`Firebase: Error (${code}).`), { code });
  return { user };
}

export async function reauthenticateWithPopup(user: { uid: string }, provider: GoogleAuthProvider) {
  calls().push(`reauth:${user.uid}:google:${provider.params.login_hint ?? ""}`);
  return { user };
}
