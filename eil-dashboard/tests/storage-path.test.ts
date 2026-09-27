import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseStoredObject } from "../src/lib/storage-path";

const OWN = "uploads-staging";
const KNOWN = [OWN, "uploads-production"];

test("a stored path keeps the bucket it names when that bucket is known", () => {
  // The pilot shares production's database. Its papers sit in production's
  // bucket, and signing them against the pilot's own bucket returned 404.
  assert.deepEqual(parseStoredObject("gs://uploads-production/pending/a/run-1/paper.pdf", OWN, KNOWN), {
    bucket: "uploads-production",
    objectName: "pending/a/run-1/paper.pdf",
    known: true,
  });
});

test("a bucket nobody listed is reported as unknown, never trusted", () => {
  const parsed = parseStoredObject("gs://someone-else/pending/a/run-1/paper.pdf", OWN, KNOWN);
  assert.equal(parsed?.known, false);
});

test("a bare object path belongs to this deployment's bucket", () => {
  assert.deepEqual(parseStoredObject("/pending/a/run-1/paper.pdf", OWN, KNOWN), {
    bucket: OWN,
    objectName: "pending/a/run-1/paper.pdf",
    known: true,
  });
});

test("paths that climb or have no object are refused", () => {
  assert.equal(parseStoredObject("gs://uploads-production/../secrets", OWN, KNOWN), null);
  assert.equal(parseStoredObject("gs://uploads-production/a\\b", OWN, KNOWN), null);
  assert.equal(parseStoredObject("gs://uploads-production", OWN, KNOWN), null);
  assert.equal(parseStoredObject("gs:///object", OWN, KNOWN), null);
  assert.equal(parseStoredObject("", OWN, KNOWN), null);
});

test("the server signs, checks and deletes only in known buckets", () => {
  const gcs = readFileSync(new URL("../src/lib/gcs-signed-urls.ts", import.meta.url), "utf8");
  // Each function that touches a stored object first checks the bucket is one
  // this deployment may use. Named rather than counted, so adding another such
  // function does not quietly pass.
  for (const fn of ["gcsObjectInfo", "gcsObjectExists", "deleteGcsObject"]) {
    const body = gcs.slice(gcs.indexOf(`export async function ${fn}`));
    const end = body.indexOf("\n}\n");
    assert.match(body.slice(0, end), /if \(!stored\?\.known\) return/, `${fn} does not check the bucket`);
  }
  const open = readFileSync(new URL("../src/app/api/workspace/library/[runId]/route.ts", import.meta.url), "utf8");
  assert.match(open, /bucketName: stored\.known \? stored\.bucket : undefined/);
  const finalize = readFileSync(new URL("../src/app/api/admin/import/finalize/route.ts", import.meta.url), "utf8");
  assert.match(finalize, /!storagePath\.startsWith\(`gs:\/\/\$\{getGcsUploadBucket\(\)\}\/`\)/, "an upload names this deployment's bucket");
});
