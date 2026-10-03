/*
 * src/components/auth/AuthProvider.tsx for render tests: no Firebase. The
 * signed-in state is whatever a test puts in globalThis.__profiledashAuth.
 */
import type { ReactNode } from "react";

declare global {
  // eslint-disable-next-line no-var
  var __profiledashAuth: Record<string, unknown> | undefined;
}

const signedOut = {
  hydrated: true,
  session: null,
  user: null,
  profile: null,
  isAdmin: false,
  authError: null,
  authErrorCode: null,
  signOut: async () => undefined,
  refreshProfile: async () => undefined,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useAuth() {
  return { ...signedOut, ...(globalThis.__profiledashAuth ?? {}) };
}
