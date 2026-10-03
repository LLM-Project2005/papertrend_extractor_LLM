/*
 * The privacy policy and terms (docs/32): the pages are rendered as the server
 * sends them, with sign-in, the theme and Next's router swapped for what each
 * test sets (tests/support/stub-auditfix-*.ts, used as they are).
 */
import assert from "node:assert/strict";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LEGAL_CONTACT_EMAIL, privacyPolicy, termsOfService } from "../src/lib/legal-content";
import { stubModule } from "./support/route-harness";

const support = (name: string) => new URL(`./support/${name}`, import.meta.url).href;
stubModule("/node_modules/next/navigation.js", support("stub-auditfix-navigation.ts"));
stubModule("/src/components/auth/AuthProvider.tsx", support("stub-auditfix-auth.ts"));
stubModule("/src/components/theme/ThemeProvider.tsx", support("stub-auditfix-theme.ts"));
(globalThis as { React?: typeof React }).React = React;

const allText = (doc: typeof privacyPolicy) =>
  [...doc.intro, ...doc.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.bullets ?? [])])].join(" ");
const decode = (html: string) =>
  html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const visible = (html: string) => decode(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
/** The text of every link to `href`. */
const linksTo = (html: string, href: string) =>
  [...html.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].filter((match) => match[1] === href).map((match) => visible(match[2]).trim());

async function legalPage(path: "privacy" | "terms") {
  globalThis.__auditfixAuth = undefined;
  const page = path === "privacy" ? await import("../src/app/privacy/page") : await import("../src/app/terms/page");
  return { metadata: page.metadata, html: renderToStaticMarkup(createElement(page.default)) };
}

test("the privacy policy and terms are published at the addresses Google is given", async () => {
  // The OAuth consent screen needs a privacy policy URL on the app's own
  // domain before the app can leave Testing.
  for (const [path, document, other] of [["privacy", privacyPolicy, "/terms"], ["terms", termsOfService, "/privacy"]] as const) {
    const { metadata, html } = await legalPage(path);
    assert.equal(metadata.alternates?.canonical, `/${path}`, path);
    assert.match(html, new RegExp(`<h1[^>]*>${document.title}</h1>`), path);
    for (const section of document.sections) assert.ok(html.includes(`id="${section.id}"`), `${path} draws ${section.id}`);
    assert.ok(linksTo(html, other).length > 0, `${path} links to ${other}`);
  }
  const { html } = await legalPage("privacy");
  assert.ok(linksTo(html, `mailto:${LEGAL_CONTACT_EMAIL}`).includes(LEGAL_CONTACT_EMAIL), "the contact address is a mail link");
});

test("the privacy policy states what Google requires and what the app actually does", () => {
  const text = allText(privacyPolicy);
  // Google API Services User Data Policy: the Limited Use disclosure.
  assert.match(text, /Google API Services User Data Policy, including the Limited Use requirements/);
  assert.match(text, /drive\.file/, "Drive access is limited to picked files");
  // Where data goes: the processors the code really sends it to.
  for (const processor of ["OpenRouter", "Google Cloud", "Firebase", "Crossref", "OpenAlex"]) {
    assert.ok(text.includes(processor), `the policy names ${processor}`);
  }
  assert.match(text, /Singapore \(asia-southeast1\)/);
  assert.match(text, /backups are kept for 7 days/, "matches the database backup retention");
  assert.match(text, /Server request logs: 30 days/, "matches the log bucket retention");
  assert.match(text, /Personal Data Protection Act B\.E\. 2562/);
  assert.ok(text.includes(LEGAL_CONTACT_EMAIL));
});

test("both documents can be found from every page and from sign-in", async () => {
  globalThis.__auditfixAuth = undefined;
  const { default: LandingPage } = await import("../src/app/page");
  const pages = [renderToStaticMarkup(createElement(LandingPage)), (await legalPage("privacy")).html, (await legalPage("terms")).html];
  for (const html of pages) {
    assert.ok(linksTo(html, "/privacy").includes("Privacy"), "the footer links the privacy policy");
    assert.ok(linksTo(html, "/terms").includes("Terms"), "and the terms");
  }

  const { default: LoginPage } = await import("../src/app/login/page");
  const login = renderToStaticMarkup(createElement(LoginPage));
  assert.match(visible(login), /By continuing, you agree to the Terms of Service and Privacy Policy \./);
  assert.deepEqual(linksTo(login, "/terms"), ["Terms of Service"]);
  assert.deepEqual(linksTo(login, "/privacy"), ["Privacy Policy"]);
  assert.ok(allText(termsOfService).includes("Privacy Policy"), "the terms point to the privacy policy");
});
