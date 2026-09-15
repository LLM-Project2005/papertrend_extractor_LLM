import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const routeUrl = new URL(
  "../src/app/api/workspace/library/[runId]/analysis/route.ts",
  import.meta.url
);

test("Cloud SQL paper lookup follows paper_content ingestion run ownership", async () => {
  const source = await readFile(routeUrl, "utf8");

  assert.match(source, /c\.ingestion_run_id=ANY\(\$2::uuid\[\]\)/);
  assert.match(source, /FROM public\.paper_content c\s+JOIN public\.papers p/);
  assert.doesNotMatch(source, /p\.ingestion_run_id=ANY/);
});

test("an out-of-scope paper is returned as a non-disclosing 404", async () => {
  const source = await readFile(routeUrl, "utf8");

  assert.match(
    source,
    /if \(!run\) \{\s+return NextResponse\.json\(\{ error: "Library file not found\." \}, \{ status: 404 \}\);/
  );
  assert.doesNotMatch(
    source,
    /if \(runError \|\| !run\) \{\s+throw new Error\(runError\?\.message \?\? "Library file not found\."\);/
  );
});
