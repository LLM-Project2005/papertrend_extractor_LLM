import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");

/** Substitutions Cloud Build provides itself. */
const BUILT_IN = new Set([
  "PROJECT_ID",
  "PROJECT_NUMBER",
  "BUILD_ID",
  "COMMIT_SHA",
  "SHORT_SHA",
  "REVISION_ID",
  "REPO_NAME",
  "BRANCH_NAME",
  "TAG_NAME",
  "LOCATION",
  "TRIGGER_NAME",
  "SERVICE_ACCOUNT",
  "SERVICE_ACCOUNT_EMAIL",
]);

/**
 * Substitutions a human supplies on the command line.
 *
 * These files are submitted manually with --substitutions, so the value comes
 * from the caller rather than the file. Trigger-driven files have no such
 * caller and must declare everything they use.
 */
const CALLER_SUPPLIED: Record<string, string[]> = {
  "cloudbuild.migration.yaml": ["_IMAGE"],
};

function cloudbuildFiles(): string[] {
  return readdirSync(ROOT).filter((name) => name.startsWith("cloudbuild") && name.endsWith(".yaml"));
}

function declaredSubstitutions(text: string): Set<string> {
  const declared = new Set<string>();
  const block = text.split(/^substitutions:\s*$/m)[1];
  if (!block) return declared;
  for (const line of block.split("\n")) {
    if (/^\S/.test(line) && !/^\s/.test(line) && line.trim() && !line.startsWith("#")) break;
    const match = line.match(/^\s{2}(_[A-Z0-9_]+):/);
    if (match) declared.add(match[1]);
  }
  return declared;
}

function referencedSubstitutions(text: string): Set<string> {
  const referenced = new Set<string>();
  for (const match of text.matchAll(/\$\{(_?[A-Z0-9_]+)\}/g)) referenced.add(match[1]);
  return referenced;
}

test("every Cloud Build file declares the substitutions it references", () => {
  // An undefined ${_VAR} substitutes to an empty string rather than failing, so
  // NEXT_PUBLIC_DIRECT_API_URL=${_APP_PUBLIC_URL} silently built an empty value
  // into production because that file names the variable _INTERNAL_APP_URL.
  const problems: string[] = [];
  for (const file of cloudbuildFiles()) {
    const text = readFileSync(join(ROOT, file), "utf8");
    const declared = declaredSubstitutions(text);
    for (const name of referencedSubstitutions(text)) {
      if (BUILT_IN.has(name)) continue;
      if ((CALLER_SUPPLIED[file] ?? []).includes(name)) continue;
      if (!declared.has(name)) problems.push(`${file}: \${${name}} is referenced but never declared`);
    }
  }
  assert.deepEqual(problems, [], problems.join("\n"));
});

test("both web deployments bake a direct API origin into the bundle", () => {
  // NEXT_PUBLIC_* values are inlined at build time, so this must be a build env
  // var; a runtime --set-env-vars would never reach the browser.
  for (const file of ["cloudbuild.web.production.yaml", "cloudbuild.web.cloudsql.pilot.yaml"]) {
    const text = readFileSync(join(ROOT, file), "utf8");
    const match = text.match(/NEXT_PUBLIC_DIRECT_API_URL=\$\{(_[A-Z0-9_]+)\}/);
    assert.ok(match, `${file} must set NEXT_PUBLIC_DIRECT_API_URL`);
    const buildVarsLine = text
      .split("\n")
      .find((line) => line.includes("NEXT_PUBLIC_DIRECT_API_URL"));
    assert.ok(buildVarsLine, `${file} must reference the value`);

    const declared = declaredSubstitutions(text);
    assert.ok(
      declared.has(match![1]),
      `${file}: NEXT_PUBLIC_DIRECT_API_URL uses \${${match![1]}}, which is not declared`
    );
    const value = text.match(new RegExp(`^\\s{2}${match![1]}:\\s*(\\S+)`, "m"))?.[1] ?? "";
    assert.match(value, /^https:\/\/.+\.run\.app$/, `${file}: ${match![1]} must be a Cloud Run origin`);
  }
});

test("the direct origin is also allowed by CORS in each deployment", () => {
  for (const file of ["cloudbuild.web.production.yaml", "cloudbuild.web.cloudsql.pilot.yaml"]) {
    const text = readFileSync(join(ROOT, file), "utf8");
    const directVar = text.match(/NEXT_PUBLIC_DIRECT_API_URL=\$\{(_[A-Z0-9_]+)\}/)![1];
    const directValue = text.match(new RegExp(`^\\s{2}${directVar}:\\s*(\\S+)`, "m"))![1];
    const allowed = text.match(/^\s{2}_APP_ALLOWED_ORIGINS:\s*(\S+)/m)?.[1] ?? "";
    // The browser calls the direct origin from the public site, so the public
    // site's origin is what must be allowed - and the direct origin must be
    // reachable, which is what this deployment serves.
    assert.ok(
      allowed.includes(directValue.replace(/\/$/, "")),
      `${file}: ${directValue} is used for direct calls but is not in _APP_ALLOWED_ORIGINS (${allowed})`
    );
  }
});
