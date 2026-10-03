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
  };
}
