/*
 * Calls route handlers as a signed-in person, against PGlite (docs/32,
 * long-term health). Three modules are swapped for this test process only:
 * Firebase's token check (firebase-admin/app and firebase-admin/auth) and the
 * Cloud SQL connection (src/lib/cloudsql/client.ts). Everything between runs
 * as written: the auth adapter and its owner mapping, the deployment gate,
 * admin-auth, the route, its guards, the repositories and their SQL, and
 * row-level security, under the app's own role as on Cloud SQL.
 *
 * Nothing here is imported by the application. A test signs someone in with
 * `signIn`, which records the Firebase subject's owner mapping as the invite
 * flow would and returns the headers of their requests.
 */
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";

export interface HarnessSession {
  uid: string;
  email: string;
}

export interface HarnessState {
  db: PGlite;
  sessions: Map<string, HarnessSession>;
}

declare global {
  // eslint-disable-next-line no-var
  var __papertrendRouteHarness: HarnessState | undefined;
}

const SUPPORT = new URL("./", import.meta.url).href;
const PACKAGE_STUBS: Record<string, string> = {
  "firebase-admin/app": new URL("./stub-firebase-app.ts", import.meta.url).href,
  "firebase-admin/auth": new URL("./stub-firebase-auth.ts", import.meta.url).href,
};
const FILE_STUBS: Array<[string, string]> = [
  ["/src/lib/cloudsql/client.ts", new URL("./stub-cloudsql-client.ts", import.meta.url).href],
];

// Node 24's synchronous module hooks (module.registerHooks): they apply to
// require() as well as import, need no flag, and run in this thread. The
// installed @types/node predates them.
interface ResolveContext {
  parentURL?: string;
  conditions?: string[];
}
interface ResolveResult {
  url: string;
  format?: string | null;
  shortCircuit?: boolean;
}
type NextResolve = (specifier: string, context?: ResolveContext) => ResolveResult;
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve): ResolveResult }): unknown;
};

let hooked = false;

function installHooks() {
  if (hooked) return;
  hooked = true;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      // The stubs themselves reach the real modules.
      if (context.parentURL?.startsWith(SUPPORT)) return nextResolve(specifier, context);
      const stub = PACKAGE_STUBS[specifier];
      if (stub) return { ...nextResolve(stub, context), shortCircuit: true };
      const resolved = nextResolve(specifier, context);
      if (resolved.url.startsWith("file:")) {
        const path = new URL(resolved.url).pathname;
        for (const [suffix, url] of FILE_STUBS) {
          if (path.endsWith(suffix)) return { ...nextResolve(url, context), shortCircuit: true };
        }
      }
      return resolved;
    },
  });
}

/**
 * Swaps one more application module for this test process, matched by the end
 * of its path (for example "/src/lib/openai.ts"), such as a model call that
 * records its prompt instead of sending it. Call it before anything that loads
 * that module is imported. A stub kept in tests/support reaches the real
 * modules it imports; one kept elsewhere is itself redirected.
 */
export function stubModule(pathSuffix: string, stubUrl: string) {
  installHooks();
  FILE_STUBS.push([pathSuffix, stubUrl]);
}

const ENV: Record<string, string> = {
  AUTH_PROVIDER: "firebase",
  DATABASE_PROVIDER: "cloud-sql",
  DEPLOYMENT_ENV: "production",
  FIREBASE_PROJECT_ID: "papertrend-route-tests",
  FIREBASE_CLIENT_EMAIL: "route-tests@papertrend.test",
  FIREBASE_PRIVATE_KEY: "route-tests-key",
  FIREBASE_AUTO_PROVISION_VERIFIED_USERS: "false",
};

/**
 * A fresh database built from schema.sql, with the app's role, and the hooks
 * in place. Call it before importing any route, so the route's modules load
 * through the hooks.
 */
export async function routeHarness(env: Record<string, string | undefined> = {}) {
  installHooks();
  for (const [key, value] of Object.entries({ ...ENV, ...env })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.exec("CREATE EXTENSION IF NOT EXISTS vector;");
  await db.exec(readFileSync(new URL("../../cloudsql/schema.sql", import.meta.url), "utf8"));
  await db.exec(`
    -- The app's role: no superuser, no bypass, as on Cloud SQL.
    CREATE ROLE papertrend_app NOSUPERUSER NOBYPASSRLS;
    GRANT USAGE ON SCHEMA public TO papertrend_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO papertrend_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO papertrend_app;
  `);
  const state: HarnessState = { db, sessions: new Map() };
  globalThis.__papertrendRouteHarness = state;
  let count = 0;

  /**
   * Signs a person in: their profile, their Firebase mapping, and a token for
   * their requests. `unmapped` gives a token Firebase accepts for a subject
   * with no Papertrend account.
   */
  async function signIn(ownerUserId: string, options: { email?: string; role?: string; unmapped?: boolean } = {}) {
    count += 1;
    const uid = `firebase-uid-${count}`;
    const email = options.email ?? `person-${count}@papertrend.test`;
    const token = `route-test-token-${count}`;
    state.sessions.set(token, { uid, email });
    if (options.unmapped) return { authorization: `Bearer ${token}` };
    await db.query(
      `INSERT INTO user_profiles (id, email, role) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role`,
      [ownerUserId, email, options.role ?? "member"]
    );
    await db.query(
      `INSERT INTO auth_identity_mappings (owner_user_id, provider, external_subject, email) VALUES ($1, 'firebase', $2, $3)
       ON CONFLICT (provider, owner_user_id) DO UPDATE SET external_subject = EXCLUDED.external_subject`,
      [ownerUserId, uid, email]
    );
    return { authorization: `Bearer ${token}` };
  }

  /** A request to a route, as JSON. */
  function request(path: string, init: { method?: string; headers?: Record<string, string>; body?: unknown } = {}) {
    const method = init.method ?? (init.body === undefined ? "GET" : "POST");
    return new Request(`https://papertrend.test${path}`, {
      method,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
    });
  }

  return { db, signIn, request };
}

/** Route params, as Next passes them. */
export function params<T extends Record<string, string>>(values: T) {
  return { params: Promise.resolve(values) };
}
