/*
 * src/components/auth/AuthProvider.tsx for render tests: no Firebase. The
 * sign-in state is whatever a test puts in globalThis.__auditfixAuth, over a
 * signed-out reader whose actions do nothing.
 */
import type { ReactNode } from "react";

declare global {
  // eslint-disable-next-line no-var
  var __auditfixAuth: Record<string, unknown> | undefined;
}

const idle = async () => undefined;

const signedOut = {
  hydrated: true,
  session: null,
  user: null,
  profile: null,
  isAdmin: false,
  authError: null,
  authErrorCode: null,
  signInWithProvider: idle,
  signInWithPassword: idle,
  signUpWithPassword: idle,
  resetPassword: idle,
  signOut: idle,
  resendVerificationEmail: idle,
  confirmEmailVerified: async () => false,
  redeemInviteCode: idle,
  refreshProfile: idle,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useAuth() {
  return { ...signedOut, ...(globalThis.__auditfixAuth ?? {}) };
}
