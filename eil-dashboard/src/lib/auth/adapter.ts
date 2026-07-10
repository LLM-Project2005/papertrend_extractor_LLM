import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import type { User } from "@supabase/supabase-js";
import {
  getAuthProvider,
  getFirebaseClientEmail,
  getFirebaseCheckRevoked,
  getFirebasePrivateKey,
  getFirebaseProjectId,
} from "@/lib/server-env";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { resolveExternalIdentityOwner } from "@/lib/auth/identity-mapping";

export class RequestAuthTimeoutError extends Error {
  constructor(message = "Authentication provider timed out.") {
    super(message);
    this.name = "RequestAuthTimeoutError";
  }
}

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

export type AuthProvider = "supabase" | "firebase";

export interface AuthIdentity {
  provider: AuthProvider;
  subject: string;
  email: string | null;
  claims: Record<string, unknown>;
  userMetadata: Record<string, unknown>;
  /**
   * The existing UUID used by Papertrend ownership checks. Firebase UIDs are
   * deliberately not put here until an explicit Cloud SQL mapping exists.
   */
  ownerUserId: string | null;
  mappingStatus?: "not_required" | "unresolved" | "mapped" | "lookup_failed";
  supabaseUser?: User;
}

export interface AuthAdapter {
  provider: AuthProvider;
  verifyBackendToken(token: string, options?: VerifyTokenOptions): Promise<AuthIdentity | null>;
}

export interface VerifyTokenOptions {
  timeoutMs?: number;
  throwOnTimeout?: boolean;
  throwOnConfiguration?: boolean;
}

export function getBearerTokenFromRequest(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return "";
  }
  return authorization.slice("Bearer ".length).trim();
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new RequestAuthTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function toClaims(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function supabaseIdentity(user: User): AuthIdentity {
  return {
    provider: "supabase",
    subject: user.id,
    ownerUserId: user.id,
    mappingStatus: "not_required",
    email: user.email ?? null,
    claims: {
      appMetadata: toClaims(user.app_metadata),
      userMetadata: toClaims(user.user_metadata),
    },
    userMetadata: toClaims(user.user_metadata),
    supabaseUser: user,
  };
}

function firebaseIdentity(token: DecodedIdToken): AuthIdentity {
  return {
    provider: "firebase",
    subject: token.uid,
    ownerUserId: null,
    email: token.email ?? null,
    claims: toClaims(token),
    userMetadata: {},
    mappingStatus: "unresolved",
  };
}

let firebaseApp: App | null = null;

function getFirebaseApp(): App {
  if (firebaseApp) {
    return firebaseApp;
  }

  const projectId = getFirebaseProjectId();
  const clientEmail = getFirebaseClientEmail();
  const privateKey = getFirebasePrivateKey().replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new AuthConfigurationError(
      "Firebase authentication is selected but its server credentials are not configured."
    );
  }

  firebaseApp = getApps()[0] ?? initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
  return firebaseApp;
}

const supabaseAdapter: AuthAdapter = {
  provider: "supabase",
  async verifyBackendToken(token, options) {
    const supabase = getSupabaseAdmin();
    const { data, error } = await withTimeout(
      supabase.auth.getUser(token),
      options?.timeoutMs ?? 8000
    );

    if (error || !data.user) {
      return null;
    }
    return supabaseIdentity(data.user);
  },
};

const firebaseAdapter: AuthAdapter = {
  provider: "firebase",
  async verifyBackendToken(token) {
    const decodedToken = await getAuth(getFirebaseApp()).verifyIdToken(
      token,
      getFirebaseCheckRevoked()
    );
    return firebaseIdentity(decodedToken);
  },
};

function getConfiguredAdapter(): AuthAdapter {
  return getAuthProvider() === "firebase" ? firebaseAdapter : supabaseAdapter;
}

export async function getAuthenticatedIdentityFromRequest(
  request: Request,
  options?: VerifyTokenOptions
): Promise<AuthIdentity | null> {
  const token = getBearerTokenFromRequest(request);
  if (!token) {
    return null;
  }

  try {
    const identity = await getConfiguredAdapter().verifyBackendToken(token, options);
    return identity ? resolveExternalIdentityOwner(identity) : null;
  } catch (error) {
    if (error instanceof RequestAuthTimeoutError && options?.throwOnTimeout) {
      throw error;
    }
    if (error instanceof AuthConfigurationError && options?.throwOnConfiguration) {
      throw error;
    }
    return null;
  }
}

export async function verifyFirebaseIdentityToken(token: string): Promise<AuthIdentity | null> {
  try {
    return await firebaseAdapter.verifyBackendToken(token);
  } catch {
    return null;
  }
}

export function getAuthIdentityFromSupabaseUser(user: User): AuthIdentity {
  return supabaseIdentity(user);
}

export function identityToLegacyUser(identity: AuthIdentity): User | null {
  if (!identity.ownerUserId) {
    return null;
  }
  if (identity.supabaseUser) {
    return identity.supabaseUser;
  }

  return {
    id: identity.ownerUserId,
    aud: "authenticated",
    role: "authenticated",
    email: identity.email,
    phone: "",
    confirmation_sent_at: null,
    confirmed_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date().toISOString(),
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: identity.provider, providers: [identity.provider] },
    user_metadata: identity.userMetadata,
    identities: [],
    factors: null,
  } as unknown as User;
}
