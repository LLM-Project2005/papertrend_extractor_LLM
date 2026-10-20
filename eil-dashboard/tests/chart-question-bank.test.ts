/*
 * The chart question bank (docs/38) stays usable: every request names a
 * collection that exists and a plan the planner can make, and the evaluation
 * judges plans the way the bank means.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ASK_DIMENSIONS } from "../src/lib/insights/ask";
import { READ_KINDS } from "../src/lib/chart-reading";
import { judge } from "../scripts/evaluate-chart-planner";

const bank = JSON.parse(readFileSync(new URL("../evals/chart-question-bank.json", import.meta.url), "utf8")) as {
  items: Array<{ id: string; scope: string; category: string; prompt: string; restated?: string; expect: Record<string, unknown> }>;
};

test("the bank holds over a hundred requests of every kind, each well formed", () => {
  assert.ok(bank.items.length >= 100, `${bank.items.length} requests`);
  const ids = bank.items.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
  const scopes = new Set(["one", "two", "six", "test", "thai", "big"]);
  const dimensions = new Set<string | null>([...ASK_DIMENSIONS, null]);
  for (const item of bank.items) {
    assert.ok(scopes.has(item.scope), `${item.id}: scope ${item.scope}`);
    assert.ok(item.prompt.trim().length > 3, item.id);
    const expect = item.expect as { tool: string; rows?: string[]; columns?: Array<string | null>; focus?: string[]; kind?: string[] };
    assert.ok(expect.tool === "build_view" || expect.tool === "read_papers", item.id);
    for (const value of [...(expect.rows ?? []), ...(expect.focus ?? [])]) assert.ok(dimensions.has(value), `${item.id}: ${value}`);
    for (const value of expect.columns ?? []) assert.ok(dimensions.has(value), `${item.id}: ${value}`);
    for (const kind of expect.kind ?? []) assert.ok((READ_KINDS as readonly string[]).includes(kind), `${item.id}: ${kind}`);
  }
  const kinds = new Set(bank.items.map((item) => item.category.split(":")[0]));
  for (const needed of ["years", "themes", "cross", "change", "narrowed", "about", "compared", "vague", "follow-up", "values", "length", "sections", "terms", "paper figures", "six papers", "one paper", "two papers", "1,500 papers", "Thai", "off topic", "not in the data"]) {
    assert.ok(kinds.has(needed), `the bank covers ${needed}`);
  }
  assert.ok(bank.items.some((item) => /[ก-๛]/.test(item.prompt)), "Thai requests");
  assert.ok(bank.items.some((item) => item.restated), "follow-ups carry the conversation");
});

test("the evaluation judges a plan against what the bank expects", () => {
  const view = (more: Record<string, unknown>) => ({ tool: "build_view" as const, query: { answerable: true, title: "", measure: "papers" as const, rows: "theme" as const, columns: null, focus: null, about: [], ...more } });
  assert.deepEqual(judge(view({}) as never, { tool: "build_view", rows: ["theme"] }), []);
  assert.deepEqual(judge(view({ rows: "method" }) as never, { tool: "build_view", rows: ["theme"] }), ["rows method"]);
  assert.deepEqual(judge(view({ answerable: false, reason: "weather" }) as never, { tool: "build_view", answerable: false }), []);
  assert.deepEqual(judge(view({}) as never, { tool: "build_view", answerable: false }), ["answered what it should decline"]);
  assert.deepEqual(judge(view({ measure: "change" }) as never, { tool: "build_view", rows: ["theme"], measure: ["change"] }), []);
  assert.deepEqual(judge(view({ focus: { dimension: "theme", values: ["Writing"] } }) as never, { tool: "build_view", rows: ["theme"], focus: ["theme"] }), []);
  const read = { tool: "read_papers" as const, read: { kind: "values", title: "", chart: "bar", field: "participants", valueType: "number", unit: "", groupBy: "paper", series: [], terms: [], search: [], about: "" } };
  assert.deepEqual(judge(read as never, { tool: "read_papers", kind: ["values"], value_type: "number" }), []);
  assert.deepEqual(judge(read as never, { tool: "read_papers", kind: ["values"], group_by: "year" }), ["group by paper"]);
  assert.deepEqual(judge(read as never, { tool: "build_view" }), ["read_papers instead of build_view"]);
  assert.deepEqual(judge(null, { tool: "build_view" }), ["no plan"]);
});
