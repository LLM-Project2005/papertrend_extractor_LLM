/*
 * The pg package for scripts run in a test: a Client whose queries go to the
 * route harness's PGlite, as the app's role (papertrend_app), in one session
 * per client as a connection through the Cloud SQL proxy would be. Ending the
 * client resets the session and calls globalThis.__profiledashPgEnded.
 */
declare global {
  // eslint-disable-next-line no-var
  var __profiledashPgEnded: (() => void) | undefined;
}

function database() {
  const state = globalThis.__papertrendRouteHarness;
  if (!state) throw new Error("The route harness is not running.");
  return state.db;
}

export class Client {
  constructor(readonly config: unknown) {}

  async connect() {
    await database().exec("SET ROLE papertrend_app");
  }

  async query(text: string, values?: unknown[]) {
    const result = await database().query(text, values);
    return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
  }

  async end() {
    await database().exec("RESET ROLE");
    await database().query("SELECT set_config('app.current_user_id', '', false)");
    globalThis.__profiledashPgEnded?.();
  }
}

export default { Client };
