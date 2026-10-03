/*
 * src/lib/firebase-client.ts for tests of the sign-in provider: no Firebase
 * SDK and no network. The deployment signs in with Firebase; the token
 * listener the provider subscribes is kept in globalThis.__smallfixTokenListener,
 * so a test plays Firebase's token events itself, and a user's ID token is the
 * `token` the test gave it. Everything else is the real module.
 */
import type { Auth, User as FirebaseUser } from "firebase/auth";
import { firebaseUserToPapertrendUser } from "../../src/lib/firebase-client";
import type { AuthProviderName, AuthSession } from "../../src/types/auth";

export * from "../../src/lib/firebase-client";

type Listener = (user: FirebaseUser | null) => void | Promise<void>;

declare global {
  // eslint-disable-next-line no-var
  var __smallfixTokenListener: Listener | undefined;
}

export function getClientAuthProvider(): AuthProviderName {
  return "firebase";
}

export function getFirebaseAuthConfigurationError(): string | null {
  return null;
}

export async function getFirebaseAuth(): Promise<Auth | null> {
  return { name: "smallfix-auth" } as unknown as Auth;
}

export async function subscribeToFirebaseTokens(_auth: Auth, listener: Listener): Promise<() => void> {
  globalThis.__smallfixTokenListener = listener;
  return () => {
    if (globalThis.__smallfixTokenListener === listener) globalThis.__smallfixTokenListener = undefined;
  };
}

export async function firebaseUserToSession(firebaseUser: FirebaseUser, ownerUserId: string): Promise<AuthSession> {
  return {
    access_token: (firebaseUser as FirebaseUser & { token: string }).token,
    refresh_token: null,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: firebaseUserToPapertrendUser(firebaseUser, ownerUserId),
    provider: "firebase",
  };
}
