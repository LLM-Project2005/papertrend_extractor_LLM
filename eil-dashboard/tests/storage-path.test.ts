import assert from "node:assert/strict";
import test from "node:test";
import { attachmentDisposition, downloadFileName, parseStoredObject } from "../src/lib/storage-path";

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

test("a downloaded paper's name: no path or quote marks, and the original extension added back", () => {
  assert.equal(downloadFileName("paper.pdf", "paper.pdf"), "paper.pdf");
  assert.equal(downloadFileName("Report.PDF", "x.pdf"), "Report.PDF");
  assert.equal(downloadFileName("Dynamic assessment", "paper.pdf"), "Dynamic assessment.pdf");
  assert.equal(downloadFileName('a/b:c?"d"', "x.pdf"), "a-b-c-d-.pdf");
  assert.equal(downloadFileName(null, "gs://uploads-staging/pending/a/run-1/scan.pdf"), "paper.pdf");
  assert.equal(downloadFileName("  ", null), "paper");
});

test("an attachment header keeps the real name in filename* and an ASCII stand-in in filename", () => {
  assert.equal(
    attachmentDisposition("Smith (2020) it's new.pdf"),
    `attachment; filename="Smith (2020) it's new.pdf"; filename*=UTF-8''Smith%20%282020%29%20it%27s%20new.pdf`
  );
  assert.equal(attachmentDisposition("ก ข.pdf"), `attachment; filename="_ _.pdf"; filename*=UTF-8''%E0%B8%81%20%E0%B8%82.pdf`);
});
