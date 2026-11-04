/*
 * firebase-admin/auth for route tests (see route-harness.ts). A token is valid
 * only if a test signed someone in with it; any other is refused the way
 * Firebase refuses a bad token.
 */
export function getAuth() {
  return {
    async verifyIdToken(token: string) {
      const session = globalThis.__papertrendRouteHarness?.sessions.get(token);
      if (!session) {
        throw Object.assign(new Error("Decoding Firebase ID token failed."), { code: "auth/argument-error" });
      }
      return { uid: session.uid, sub: session.uid, email: session.email, email_verified: true, aud: "papertrend-route-tests" };
    },
    /** Deleting an account removes its sign-in: the uid is noted, and its tokens stop working. */
    async deleteUser(uid: string) {
      const state = globalThis.__papertrendRouteHarness as (typeof globalThis.__papertrendRouteHarness & { deletedFirebaseUids?: string[] }) | undefined;
      if (!state) return;
      (state.deletedFirebaseUids ??= []).push(uid);
      for (const [token, session] of state.sessions) if (session.uid === uid) state.sessions.delete(token);
    },
  };
}
