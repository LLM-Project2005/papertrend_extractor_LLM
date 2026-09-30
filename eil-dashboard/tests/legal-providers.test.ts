import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { privacyPolicy, termsOfService } from "../src/lib/legal-content";

/*
 * The privacy policy names every way to sign in and every outside service that
 * receives data (docs/32, 1.6). A new provider in the code fails these tests
 * until the policy says who it is and what it receives.
 */

const repo = fileURLToPath(new URL("../..", import.meta.url));

function filesUnder(dir: string, pattern: RegExp): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === "node_modules" || name === "__pycache__" || name.startsWith(".")) return [];
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return filesUnder(path, pattern);
    return pattern.test(name) ? [path] : [];
  });
}

/** The web app, the worker and the analysis nodes, but not tests. */
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

/** Addresses in the code that are never requested: links built for citations, and placeholders. */
const NOT_REQUESTED = new Set(["doi.org", "example.org", "papertrend.app", "return-path.invalid"]);

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

test("every way to sign in is named, Facebook with what Meta shares", () => {
  const providers = new Set([...code.matchAll(/new (\w+)AuthProvider\(/g)].map((match) => match[1]));
  assert.deepEqual([...providers].sort(), ["Facebook", "Google"], "a new sign-in provider must be added to the policy");
  assert.match(code, /signInWithEmailAndPassword/);
  assert.match(policy, /how you sign in \(Google, Facebook, or email and password\)/);
  const facebook = privacyPolicy.sections.find((section) => section.id === "facebook-sign-in");
  assert.ok(facebook, "a Facebook sign-in section");
  assert.match((facebook.bullets ?? []).join(" "), /Meta[\s\S]*name, email address and profile picture/);
});

test("the policy says deep research can search the web on its own, and the terms name the spending limits", () => {
  // Deep research plans with the web always available (docs/31).
  assert.match(code, /parsePlan\(raw, \{ question: prompt, webAvailable: true \}\)/);
  assert.match(policy, /Deep research decides on its own whether a question needs the web/);
  assert.match(policy, /The text of your papers is not sent to the web search/);
  // Chat's web search is off until the reader turns it on.
  assert.match(code, /const \[webSearchEnabled, setWebSearchEnabled\] = useState\(false\)/);
  assert.match(policy, /If you turn on web search in chat/);
  assert.match(policy, /model fees each AI request used/);
  assert.match(policyText(termsOfService), /daily AI spending limit/);
});
