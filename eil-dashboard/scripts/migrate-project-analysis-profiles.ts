import { Client, type ClientConfig } from "pg";
import { parseIntoClientConfig } from "pg-connection-string";
import { projectProfileFromLegacyWorkspace, sanitizeProjectAnalysisProfile } from "../src/lib/project-analysis-profile";

function readOwnerUserIds(): string[] {
  const values: string[] = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] !== "--owner-user-id") continue;
    const value = process.argv[index + 1]?.trim();
    if (!value) throw new Error("--owner-user-id requires a UUID value.");
    values.push(...value.split(",").map((entry) => entry.trim()).filter(Boolean));
  }
  for (const value of values) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new Error(`Invalid owner UUID: ${value}`);
    }
  }
  return [...new Set(values)];
}

function localConnectionConfig(value: string): ClientConfig {
  return {
    ...parseIntoClientConfig(value.trim()),
    host: process.env.CLOUDSQL_PROXY_HOST ?? "127.0.0.1",
    port: Number(process.env.CLOUDSQL_PROXY_PORT ?? "5432"),
    ssl: false,
    application_name: "papertrend-project-profile-migration",
  };
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");
  const apply = process.argv.includes("--apply");
  const ownerUserIds = readOwnerUserIds();
  const client = new Client(localConnectionConfig(databaseUrl));
  await client.connect();
  try {
    const identity = await client.query<{ current_user: string }>("SELECT current_user");
    const databaseUser = identity.rows[0]?.current_user ?? "unknown";
    if (databaseUser === "papertrend_app" && ownerUserIds.length !== 1) {
      throw new Error(
        "Exactly one --owner-user-id is required when using papertrend_app because forced RLS exposes " +
        "one owner per session. Run the command once for each mapped Papertrend owner UUID."
      );
    }

    if (ownerUserIds.length === 1) {
      await client.query("SELECT set_config('app.current_user_id',$1,false)", [ownerUserIds[0]]);
    }
    const ownerFilter = ownerUserIds.length > 0 ? "WHERE p.owner_user_id = ANY($1::uuid[])" : "";
    const projects = await client.query<Record<string, unknown>>(
      `SELECT p.id::text,p.owner_user_id::text,p.name,p.analysis_profile,p.analysis_profile_hash,u.workspace_profile
       FROM public.workspace_projects p
       LEFT JOIN public.user_profiles u ON u.id=p.owner_user_id
       ${ownerFilter}
       ORDER BY p.owner_user_id,p.name`,
      ownerUserIds.length > 0 ? [ownerUserIds] : []
    );
    const changes = projects.rows.map((row) => {
      const accountProfile = projectProfileFromLegacyWorkspace(row.workspace_profile as never);
      let profile = accountProfile;
      try {
        const storedProfile = row.analysis_profile
          ? sanitizeProjectAnalysisProfile(row.analysis_profile)
          : accountProfile;
        profile = storedProfile.mode === "custom" && accountProfile.mode === "eil"
          ? accountProfile
          : storedProfile;
      } catch {
        profile = accountProfile;
      }
      return {
        projectId: String(row.id),
        projectName: String(row.name),
        mode: profile.mode,
        profileHash: profile.profileHash,
        changed: row.analysis_profile_hash !== profile.profileHash,
        profile,
      };
    });
    if (apply) {
      await client.query("BEGIN");
      try {
        for (const change of changes) {
          await client.query(
            `UPDATE public.workspace_projects SET analysis_profile=$2::jsonb,analysis_profile_version=$3,
             analysis_profile_hash=$4,analysis_profile_updated_at=COALESCE(analysis_profile_updated_at,now()),updated_at=now()
             WHERE id=$1`,
            [change.projectId, JSON.stringify(change.profile), change.profile.version, change.profileHash]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      dryRun: !apply,
      databaseUser,
      ownerUserIds,
      projects: changes.map(({ profile: _profile, ...change }) => change),
      changed: changes.filter((change) => change.changed).length,
    }, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
