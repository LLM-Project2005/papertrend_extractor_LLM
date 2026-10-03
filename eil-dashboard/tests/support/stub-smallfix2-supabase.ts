/*
 * src/lib/supabase.ts for tests of the Supabase sign-in in AuthProvider: no
 * session, and each OAuth sign-in asked for is recorded in
 * globalThis.__smallfix2OAuth instead of being sent.
 */
declare global {
  // eslint-disable-next-line no-var
  var __smallfix2OAuth: Array<{ provider: string; options?: { redirectTo?: string } }> | undefined;
}

export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    signInWithOAuth: async (request: { provider: string; options?: { redirectTo?: string } }) => {
      (globalThis.__smallfix2OAuth ??= []).push(request);
      return { data: { url: "https://auth.papertrend.test/authorize" }, error: null };
    },
    signOut: async () => ({ error: null }),
  },
};
