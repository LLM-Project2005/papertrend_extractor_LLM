import assert from "node:assert/strict";
import test from "node:test";

import { putFileWithRetry } from "../src/lib/upload-retry";

const noSleep = async () => {};

function responses(...items: Array<number | Error>) {
  const calls: number[] = [];
  const fetchImpl = (async () => {
    const item = items[calls.length] ?? 200;
    calls.push(calls.length + 1);
    if (item instanceof Error) throw item;
    return new Response(item === 200 ? "" : `status ${item}`, { status: item });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("a dropped connection is retried and the upload succeeds", async () => {
  const { calls, fetchImpl } = responses(new TypeError("Failed to fetch"), 200);
  await putFileWithRetry("https://storage/upload", new Blob(["pdf"]), {}, { sleep: noSleep, fetchImpl });
  assert.equal(calls.length, 2);
});

test("server errors are retried up to the attempt limit", async () => {
  const { calls, fetchImpl } = responses(503, 502, 500);
  await assert.rejects(
    putFileWithRetry("https://storage/upload", new Blob(["pdf"]), {}, { sleep: noSleep, fetchImpl }),
    /after 3 attempts/
  );
  assert.equal(calls.length, 3);
});

test("a rejected signature is not retried", async () => {
  const { calls, fetchImpl } = responses(403);
  await assert.rejects(
    putFileWithRetry("https://storage/upload", new Blob(["pdf"]), {}, { sleep: noSleep, fetchImpl }),
    /status 403/
  );
  assert.equal(calls.length, 1);
});

test("a conflict on a retry means the first attempt already stored the file", async () => {
  const { calls, fetchImpl } = responses(new TypeError("Failed to fetch"), 409);
  await putFileWithRetry("https://storage/upload", new Blob(["pdf"]), {}, { sleep: noSleep, fetchImpl });
  assert.equal(calls.length, 2);
});
