import assert from "node:assert/strict";
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

// That the server signs, checks, deletes and finalizes only in known buckets
// runs against a stand-in storage client in small-fixes2-behaviour-uploads.test.ts.
