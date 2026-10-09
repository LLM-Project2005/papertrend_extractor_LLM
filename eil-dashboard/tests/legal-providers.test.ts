import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { mock, test } from "node:test";
import { fileURLToPath } from "node:url";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { privacyPolicy, termsOfService } from "../src/lib/legal-content";
import { paperIdFromRunId } from "../src/lib/paper-id";
import { routeHarness, stubModule } from "./support/route-harness";

/*
 * The privacy policy names every way to sign in and every outside service that
 * receives data (docs/32, 1.6). A new provider in the code fails these tests
 * until the policy says who it is and what it receives: the code is read as an
 * inventory of hosts and providers, which no single run could collect. What
 * the policy says the app does is run: deep research is planned through the
 * chat route against PGlite (tests/support/route-harness.ts) with the model
 * behind fetch, and the chat page is rendered with its contexts swapped
 * (tests/support/stub-auditfix-*.ts).
 */

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/workspace/WorkspaceProvider.tsx", support("stub-auditfix-workspace.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
stubModule("/src/components/chat/ChatIntro.tsx", support("stub-chatanswer-intro.ts"));
(globalThis as { React?: typeof React }).React = React;

const repo = fileURLToPath(new URL("../..", import.meta.url));

function filesUnder(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "__pycache__" || name.startsWith(".")) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

/**
 * The web app, the worker and the analysis nodes, but not tests. Kept as text:
 * an inventory of every host and provider the code could call, which no run
 * of the app would collect.
 */
const code = [
  ...filesUnder(join(repo, "eil-dashboard", "src"), /\.(ts|tsx)$/),
  ...filesUnder(join(repo, "eil-dashboard", "worker"), /\.py$/),
  ...filesUnder(join(repo, "nodes"), /\.py$/),
  ...readdirSync(repo).filter((name) => name.endsWith(".py")).map((name) => join(repo, name)),
].map((path) => readFileSync(path, "utf8")).join("\n");

const policyText = (document: typeof privacyPolicy) =>
  [...document.intro, ...document.sections.flatMap((section) => [section.heading, ...(section.paragraphs ?? []), ...(section.bullets ?? [])])].join("\n");
const policy = policyText(privacyPolicy);

/** Every host the code sends requests to, and the name the policy gives it. */
const PROVIDERS: Record<string, string> = {
  "openrouter.ai": "OpenRouter",
  "api.openai.com": "OpenAI",
  "api.crossref.org": "Crossref",
  "api.openalex.org": "OpenAlex",
  "www.googleapis.com": "Google",
  "oauth2.googleapis.com": "Google",
  "accounts.google.com": "Google",
  "apis.google.com": "Google",
  "storage.googleapis.com": "Google Cloud",
  "cloudtasks.googleapis.com": "Google Cloud",
};

/**
 * Addresses in the code that are never requested: links built for citations,
 * placeholders, and the team's own pages, which a reader may follow from /team.
 */
const NOT_REQUESTED = new Set(["doi.org", "example.org", "papertrend.app", "return-path.invalid", "github.com", "jakapunt.github.io"]);

test("every outside service the code calls is named in the privacy policy", () => {
  const hosts = new Set([...code.matchAll(/https:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)].map((match) => match[1].toLowerCase()));
  const unlisted = [...hosts].filter((host) => !(host in PROVIDERS) && !NOT_REQUESTED.has(host));
  assert.deepEqual(unlisted, [], "add each new host to PROVIDERS and describe it in legal-content.ts");
  // And the list holds only hosts the code still calls, so the scan is seen to work.
  assert.deepEqual(Object.keys(PROVIDERS).filter((host) => !hosts.has(host)), []);
  for (const name of new Set(Object.values(PROVIDERS))) assert.match(policy, new RegExp(`\\b${name}\\b`), name);
});

test("every web search engine is named, with what it receives", () => {
  const engines = new Set([...code.matchAll(/engine: "([a-z]+)"/g)].map((match) => match[1]));
  assert.deepEqual([...engines], ["exa"], "a new search engine must be added to the policy");
  assert.match(policy, /Exa receives (?:the search query|web search queries)/);
});

test("every way to sign in is named, Facebook with what Meta shares", async () => {
  const providers = new Set([...code.matchAll(/new (\w+)AuthProvider\(/g)].map((match) => match[1]));
  assert.deepEqual([...providers].sort(), ["Facebook", "Google"], "a new sign-in provider must be added to the policy");
  // The sign-in page offers exactly these, and email and password.
  globalThis.__auditfixAuth = undefined;
  const { default: AuthPanel } = await import("../src/components/auth/AuthPanel");
  const panel = renderToStaticMarkup(createElement(AuthPanel));
  const offered = [...panel.matchAll(/>(Continue with [A-Za-z]+)</g)].map((match) => match[1]);
  assert.deepEqual(offered, ["Continue with Google", "Continue with Facebook"]);
  assert.match(panel, /<input[^>]*type="email"/);
  assert.match(panel, /<input[^>]*type="password"/);
  assert.match(policy, /how you sign in \(Google, Facebook, or email and password\)/);
  const facebook = privacyPolicy.sections.find((section) => section.id === "facebook-sign-in");
  assert.ok(facebook, "a Facebook sign-in section");
  assert.match((facebook.bullets ?? []).join(" "), /Meta[\s\S]*name, email address and profile picture/);
});

test("the policy says deep research can search the web on its own, and the terms name the spending limits", async () => {
  assert.match(policy, /Deep research decides on its own whether a question needs the web/);
  assert.match(policy, /The text of your papers is not sent to the web search/);
  assert.match(policy, /If you turn on web search in chat/);
  assert.match(policy, /model fees each AI request used/);
  assert.match(policyText(termsOfService), /daily AI spending limit/);
});

const OWNER = "00000000-0000-4000-8000-00000000000a";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";

test("deep research plans with the web available, so a question about current policy is searched for on the web", async () => {
  // Deep research plans with the web always available (docs/31); the reader
  // does not turn it on, which is why the policy says so.
  const harness = await routeHarness({ OPENAI_API_KEY: "test-key", OPENAI_BASE_URL: "https://openrouter.ai/api/v1", DEEP_RESEARCH_TASKS_QUEUE: undefined });
  const owner = await harness.signIn(OWNER);
  const FOLDER = "00000000-0000-4000-8000-0000000000f1";
  const RUN = "1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51";
  const paperId = paperIdFromRunId(RUN);
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at)
      VALUES ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Assessment', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES ('${FOLDER}', '${OWNER}', 'Papers', '${PROJECT}');
    INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, source_filename, input_payload, completed_at)
      VALUES ('${RUN}', '${OWNER}', '${FOLDER}', 'upload', 'succeeded', 'paper.pdf', '{}'::jsonb, now());
    INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES (${paperId}, '${OWNER}', '${FOLDER}', '2021', 'Washback of a National English Test');
    INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id, abstract) VALUES (${paperId}, '${OWNER}', '${FOLDER}', '${RUN}', 'This study examined test washback in Thai schools.');
  `);
  // The planner asks for the web on the question about current policy, and the papers on the other.
  const plan = {
    title: "Washback and current policy",
    language: "English",
    analytics: false,
    outline: [],
    questions: [
      { question: "What do current national policies require of English tests?", purpose: "Policy now.", sources: "web", queries: ["English test policy Thailand"] },
      { question: "What washback did the papers find?", purpose: "The papers.", sources: "papers", queries: ["washback"] },
    ],
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    assert.equal(url, "https://openrouter.ai/api/v1/chat/completions", "only the model is asked");
    const tool = JSON.parse(String(init?.body)).tool_choice?.function?.name;
    assert.equal(tool, "write_plan");
    return Response.json({
      model: "fake",
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cost: 0.001 },
      choices: [{ message: { content: null, tool_calls: [{ type: "function", function: { name: tool, arguments: JSON.stringify(plan) } }] } }],
    });
  }) as typeof fetch;
  const quiet = mock.method(console, "info", () => undefined);
  try {
    const { POST } = await import("../src/app/api/chat/route");
    const response = await POST(
      harness.request("/api/chat", {
        headers: owner,
        body: { chatMode: "deep_research", action: "plan", message: "How does current policy compare with these papers?", projectId: PROJECT, knowledgeScope: { kind: "project", projectId: PROJECT } },
      })
    );
    assert.equal(response.status, 200);
  } finally {
    quiet.mock.restore();
    globalThis.fetch = realFetch;
  }
  const planned = await harness.db.query<{ question: string; sources: string }>(
    `SELECT input_payload->'question'->>'question' AS question, input_payload->'question'->>'sources' AS sources
     FROM deep_research_steps WHERE tool_name = 'dr2_gather' ORDER BY position`
  );
  assert.deepEqual(planned.rows.map((row) => row.sources), ["web", "papers"]);
});

test("chat's web search is off until the reader turns it on", async () => {
  globalThis.__auditfixAuth = { user: { id: OWNER, email: "reader@papertrend.test" }, session: { access_token: "reader-token" } };
  globalThis.__auditfixWorkspace = { currentProject: { id: PROJECT, name: "Assessment" }, hasActiveProject: true, selectedProjectId: PROJECT, allProjects: [{ id: PROJECT, name: "Assessment" }], selectedYears: [], selectedTracks: [], searchQuery: "" };
  const { default: ChatClient } = await import("../src/components/chat/ChatClient");
  const page = renderToStaticMarkup(createElement(ChatClient));
  assert.doesNotMatch(page, /aria-label="Disable web search"/, "no web search chip");

  // The first question a reader asks goes without the web.
  const realFetch = globalThis.fetch;
  let sent!: (body: Record<string, unknown>) => void;
  const request = new Promise<Record<string, unknown>>((resolve) => (sent = resolve));
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === "/api/chat") sent(JSON.parse(String(init?.body)));
    return Response.json({ answer: "Two papers." });
  }) as typeof fetch;
  try {
    const intro = globalThis.__chatAnswerIntroProps;
    assert.ok(intro, "the empty page offers questions to ask");
    intro.onAsk(intro.examples[0].text);
    const body = await request;
    assert.equal(body.webSearchEnabled, false);
    assert.equal(body.toolMode, "auto");
  } finally {
    globalThis.fetch = realFetch;
  }
});
