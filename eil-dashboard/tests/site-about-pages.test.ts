/*
 * The How it works and Team pages (2026-10-09, from the team's drafts). The
 * draft told the analysis as six agents; the page tells it as six stages, and
 * this file holds that account to the code: the stages and the steps beside
 * them are exactly the analysis graph's steps, the planner's operations are
 * the chat's own, agreement across papers is the theme service's rule, and
 * the copy keeps the site's honesty rules. Both pages must be reachable from
 * the header, the phone menu and the footer.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { stubModule } from "./support/route-harness";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-siteui-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
stubModule("/src/components/workspace/WorkspaceGlobalSearch.tsx", support("stub-auditfix-search.ts"));
(globalThis as { React?: typeof React }).React = React;

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path: string) => existsSync(new URL(`../${path}`, import.meta.url));
const decode = (value: string) =>
  value.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&");
const text = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
const attribute = (open: string, name: string) => decode(new RegExp(`\\s${name}="([^"]*)"`).exec(open)?.[1] ?? "");

async function page(path: "how-it-works" | "team" | "home") {
  globalThis.__auditfixTheme = "light";
  globalThis.__auditfixAuth = undefined;
  const module = path === "how-it-works" ? await import("../src/app/how-it-works/page") : path === "team" ? await import("../src/app/team/page") : await import("../src/app/page");
  return renderToStaticMarkup(createElement(module.default));
}

/* ------------------------------------------------- the account of the system */

test("the six stages and the steps beside them are exactly the analysis graph's steps", async () => {
  const { ALONGSIDE_STEPS, ANALYSIS_STEP_COUNT, SAVE_STEP, TOPIC_STAGES } = await import("../src/components/marketing/how-it-works-content");
  const graph = [...read("../graphs.py").matchAll(/add_node\("([a-z_]+)"/g)].map((match) => match[1]);
  const told = [...TOPIC_STAGES.flatMap((stage) => stage.steps), ...ALONGSIDE_STEPS, SAVE_STEP];
  assert.equal(new Set(told).size, told.length, "no step is told twice");
  assert.deepEqual([...told].sort(), [...graph].sort());
  assert.equal(ANALYSIS_STEP_COUNT, graph.length);
  assert.equal(TOPIC_STAGES.length, 6);
});

test("the planner's operations are the chat's own", async () => {
  const { PLANNER_OPERATIONS } = await import("../src/components/marketing/how-it-works-content");
  const source = read("src/lib/repository-chat.ts");
  const union = /export type RepositoryOperation =([^;]+);/.exec(source)?.[1] ?? "";
  const operations = [...union.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]);
  assert.ok(operations.length >= 8);
  assert.deepEqual(PLANNER_OPERATIONS.map((operation) => operation.key).sort(), operations.sort());
});

test("agreement across papers is the theme service's rule, and the figure follows it", async () => {
  const { CONSENSUS_AGREEMENT, CONSENSUS_RUNS } = await import("../src/lib/topic-themes");
  const { SAMPLE_MERGES } = await import("../src/components/marketing/how-it-works-content");
  assert.equal(CONSENSUS_RUNS, 3, "the page says three groupings");
  assert.ok(2 / 3 >= CONSENSUS_AGREEMENT && 1 / 3 < CONSENSUS_AGREEMENT, "the page says two of three merge and one does not");
  const html = await page("how-it-works");
  const decisions = [...html.matchAll(/>(Not merged|Merged)<\/span>/g)].map((match) => match[1]);
  assert.deepEqual(
    decisions,
    SAMPLE_MERGES.map((merge) => (merge.votes.length === CONSENSUS_RUNS && merge.votes.filter(Boolean).length >= 2 ? "Merged" : "Not merged"))
  );
});

test("each stage says what its step's code enforces", async () => {
  const words = text(await page("how-it-works"));
  const extractor = read("../nodes/keyword_extractor.py");
  assert.equal(/MAX_METHOD_CANDIDATES = (\d+)/.exec(extractor)?.[1], "3");
  assert.ok(words.includes("at most three methods"));
  assert.match(read("../prompts/keyword_extractor.txt"), /Return 12 to 20 concepts/);
  assert.ok(words.includes("12 to 20 concepts"));
  assert.match(read("../nodes/keyword_grouper.py"), /"evidence": safe_json_list\(\[[^\]]+\], limit=6\)/);
  assert.ok(words.includes("up to six of its sentences"));
  assert.match(read("../nodes/topic_labeler.py"), /two to five words and distinct/);
  assert.ok(words.includes("two to five words"));
});

test("the chat trace says what the chat does", async () => {
  const { CACHE_TTL_MS } = await import("../src/lib/answer-cache");
  const { CHAT_TRACE } = await import("../src/components/marketing/how-it-works-content");
  assert.equal(CACHE_TTL_MS, 30 * 60_000);
  assert.ok(CHAT_TRACE.some((step) => step.detail?.includes("within 30 minutes")));
  // The audit is skipped for a clean, confident draft (repository-chat.ts, auditSkipBlocker).
  assert.match(read("src/lib/repository-chat.ts"), /export function auditSkipBlocker/);
  const check = CHAT_TRACE.find((step) => step.title.startsWith("Check the draft"));
  assert.ok(check?.detail?.includes("less than certain"));
});

test("the pages keep the site's honesty rules", async () => {
  for (const html of [await page("how-it-works"), await page("team")]) {
    const words = text(html);
    assert.equal(/confidence/i.test(words), false, "year and answer confidence are not shown to readers");
    assert.equal(/every answer is (?:audited|checked)|audit(?:ed|s) every|every time\./i.test(words), false, "the answer check is skipped for confident drafts");
    assert.equal(/12 analysis stages|six agents/i.test(words), false);
    assert.equal(/never followed by any model/i.test(words), false, "no model can promise that");
  }
});

/* --------------------------------------------------------------- the team */

test("the team page shows each person with their portrait, both names and a way to reach them", async () => {
  const html = await page("team");
  const people = [
    { name: "Jakapun Tachaiya", thai: "อ.ดร.จักรพันธ์ เตไชยา", photo: "jakapun", links: ["https://jakapunt.github.io/", "mailto:jakapun.t@chula.ac.th"] },
    { name: "Pheemaphat Chantarusorn", thai: "ภีมพัศ จันทรุสอน", photo: "pheemaphat", links: ["mailto:p.chantarusorn@gmail.com", "https://github.com/pheechan"] },
    { name: "Thanawat Traipat", thai: "ธนวัฒน์ ไตรพัชร์", photo: "thanawat", links: ["mailto:thanawattraipat@gmail.com", "https://github.com/Thanawat-Traipat"] },
  ];
  const images = [...html.matchAll(/<img\b[^>]*>/g)].map((match) => match[0]);
  for (const person of people) {
    assert.ok(html.includes(`>${person.name}</h2>`), person.name);
    assert.ok(new RegExp(`<p lang="th"[^>]*>${person.thai}</p>`).test(html), `${person.name}'s Thai name is marked as Thai`);
    const image = images.find((tag) => attribute(tag, "src") === `/marketing/team/${person.photo}.webp`);
    assert.ok(image, `${person.name}'s portrait`);
    assert.ok(exists(`public/marketing/team/${person.photo}.webp`));
    assert.equal(attribute(image, "alt"), `Portrait of ${person.name}`);
    assert.equal(attribute(image, "width"), "800");
    assert.equal(attribute(image, "height"), "1000");
    for (const link of person.links) assert.ok(html.includes(`href="${link}"`), link);
  }
});

/* ------------------------------------------------------------ the way there */

test("both pages are reached from the header, the phone menu and the footer, and the header marks the one you are on", async () => {
  const home = await page("home");
  for (const href of ["/how-it-works", "/team"]) {
    const links = [...home.matchAll(new RegExp(`<a\\b[^>]*href="${href}"[^>]*>`, "g"))];
    assert.ok(links.length >= 3, `${href} is linked ${links.length} times`);
  }
  for (const [path, href] of [["how-it-works", "/how-it-works"], ["team", "/team"]] as const) {
    const html = await page(path);
    const current = [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)].map((match) => attribute(match[0], "href"));
    assert.deepEqual(current, [href]);
    assert.equal((html.match(/<h1\b/g) ?? []).length, 1, `${path} has one headline`);
  }
});
