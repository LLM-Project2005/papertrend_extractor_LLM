"use client";

import type { FirebaseApp } from "firebase/app";
import type { Auth, User as FirebaseUser } from "firebase/auth";
import type { User } from "@supabase/supabase-js";
import type { AuthProviderName, AuthSession } from "@/types/auth";

export type { FirebaseUser };

const FIREBASE_APP_NAME = "papertrend-auth";

export function getClientAuthProvider(): AuthProviderName {
  const provider = (process.env.NEXT_PUBLIC_AUTH_PROVIDER ?? "supabase").trim().toLowerCase();
  return provider === "firebase" || provider === "identity-platform" ? "firebase" : "supabase";
}

function getFirebaseConfig() {
  const apiKey = process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "";
  const authDomain = process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "";
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "";
  const appId = process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "";

  if (!apiKey || !authDomain || !projectId || !appId) {
    return null;
  }

  return { apiKey, authDomain, projectId, appId };
}

export async function getFirebaseAuth(): Promise<Auth | null> {
  const config = getFirebaseConfig();
  if (!config) {
    return null;
  }

  const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([
    import("firebase/app"),
    import("firebase/auth"),
  ]);
  const existingApp = getApps().find((app) => app.name === FIREBASE_APP_NAME);
  const app: FirebaseApp = existingApp ?? initializeApp(config, FIREBASE_APP_NAME);
  return getAuth(app);
}

export function getFirebaseAuthConfigurationError(): string | null {
  if (getClientAuthProvider() !== "firebase") {
    return null;
  }
  return getFirebaseConfig()
    ? null
    : "Firebase authentication is selected, but its public web configuration is incomplete.";
}

export function firebaseUserToPapertrendUser(
  firebaseUser: FirebaseUser,
  ownerUserId: string
): User {
  return {
    id: ownerUserId,
    aud: "authenticated",
    role: "authenticated",
    email: firebaseUser.email,
    phone: firebaseUser.phoneNumber ?? "",
    confirmation_sent_at: null,
    confirmed_at: firebaseUser.emailVerified ? firebaseUser.metadata.creationTime ?? null : null,
    created_at: firebaseUser.metadata.creationTime ?? new Date().toISOString(),
    updated_at: firebaseUser.metadata.lastSignInTime ?? new Date().toISOString(),
    last_sign_in_at: firebaseUser.metadata.lastSignInTime ?? null,
    app_metadata: {
      provider: "firebase",
      providers: ["firebase"],
      firebase_uid: firebaseUser.uid,
    },
    user_metadata: {
      full_name: firebaseUser.displayName ?? null,
      avatar_url: firebaseUser.photoURL ?? null,
    },
    identities: [],
    factors: null,
  } as unknown as User;
}

export async function firebaseUserToSession(
  firebaseUser: FirebaseUser,
  ownerUserId: string
): Promise<AuthSession> {
  const { getIdToken } = await import("firebase/auth");
  const accessToken = await getIdToken(firebaseUser);
  return {
    access_token: accessToken,
    refresh_token: null,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: firebaseUserToPapertrendUser(firebaseUser, ownerUserId),
    provider: "firebase",
  };
}

export async function subscribeToFirebaseTokens(
  auth: Auth,
  listener: (user: FirebaseUser | null) => void | Promise<void>
): Promise<() => void> {
  const { onIdTokenChanged } = await import("firebase/auth");
  return onIdTokenChanged(auth, listener);
}

export async function signInWithFirebaseProvider(
  auth: Auth,
  provider: "google" | "facebook"
): Promise<void> {
  const { FacebookAuthProvider, GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
  const authProvider =
    provider === "google" ? new GoogleAuthProvider() : new FacebookAuthProvider();
  await signInWithPopup(auth, authProvider);
}

export async function signInWithFirebasePassword(
  auth: Auth,
  email: string,
  password: string
): Promise<void> {
  const { signInWithEmailAndPassword } = await import("firebase/auth");
  await signInWithEmailAndPassword(auth, email, password);
}

export async function signUpWithFirebasePassword(
  auth: Auth,
  email: string,
  password: string,
  fullName?: string
): Promise<void> {
  const { createUserWithEmailAndPassword, updateProfile } = await import("firebase/auth");
  const result = await createUserWithEmailAndPassword(auth, email, password);
  if (fullName?.trim()) {
    await updateProfile(result.user, { displayName: fullName.trim() });
  }
}

export async function sendFirebasePasswordReset(auth: Auth, email: string): Promise<void> {
  const { sendPasswordResetEmail } = await import("firebase/auth");
  await sendPasswordResetEmail(auth, email);
}

export async function signOutFirebase(auth: Auth): Promise<void> {
  const { signOut } = await import("firebase/auth");
  await signOut(auth);
}

export async function updateFirebaseUserProfile(
  user: FirebaseUser,
  updates: { displayName?: string | null; photoURL?: string | null }
): Promise<void> {
  const { updateProfile } = await import("firebase/auth");
  await updateProfile(user, updates);
}
