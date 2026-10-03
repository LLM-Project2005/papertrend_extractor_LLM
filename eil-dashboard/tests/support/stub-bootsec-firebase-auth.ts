/*
 * firebase-admin/auth for route tests that need to see each token check, or a
 * claim the route harness's stub does not set. Like stub-firebase-auth.ts, a
 * token is valid only if a test signed someone in with it; each check is
 * recorded in globalThis.__bootsecTokenChecks, and a token's claims can be
 * changed through globalThis.__bootsecClaims (for example an unconfirmed
 * email). Installed by bootsecFirebaseChecks().
 */
import * as nodeModule from "node:module";

export interface TokenCheck {
  token: string;
  checkRevoked: boolean | undefined;
}

declare global {
  // eslint-disable-next-line no-var
  var __bootsecTokenChecks: TokenCheck[] | undefined;
  // eslint-disable-next-line no-var
  var __bootsecClaims: Record<string, Record<string, unknown>> | undefined;
}

export function getAuth() {
  return {
    async verifyIdToken(token: string, checkRevoked?: boolean) {
      (globalThis.__bootsecTokenChecks ??= []).push({ token, checkRevoked });
      const session = globalThis.__papertrendRouteHarness?.sessions.get(token);
      if (!session) {
        throw Object.assign(new Error("Decoding Firebase ID token failed."), { code: "auth/argument-error" });
      }
      return {
        uid: session.uid,
        sub: session.uid,
        email: session.email,
        email_verified: true,
        aud: "papertrend-route-tests",
        ...(globalThis.__bootsecClaims?.[token] ?? {}),
      };
    },
  };
}

interface ResolveResult {
  url: string;
  format?: string | null;
  shortCircuit?: boolean;
}
type NextResolve = (specifier: string, context?: object) => ResolveResult;

let installed = false;

/**
 * Sends the application's firebase-admin/auth here. Call it after
 * routeHarness(): a hook registered later runs first, ahead of the harness's.
 */
export function bootsecFirebaseChecks() {
  if (installed) return;
  installed = true;
  const self = import.meta.url;
  const { registerHooks } = nodeModule as unknown as {
    registerHooks(hooks: { resolve(specifier: string, context: object, nextResolve: NextResolve): ResolveResult }): unknown;
  };
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "firebase-admin/auth") return { ...nextResolve(self, context), shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
}
