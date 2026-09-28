import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { LEGAL_CONTACT_EMAIL, privacyPolicy, termsOfService } from "../src/lib/legal-content";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const allText = (doc: typeof privacyPolicy) =>
  [...doc.intro, ...doc.sections.flatMap((s) => [s.heading, ...(s.paragraphs ?? []), ...(s.bullets ?? [])])].join(" ");

test("the privacy policy and terms are published at the addresses Google is given", () => {
  // The OAuth consent screen needs a privacy policy URL on the app's own
  // domain before the app can leave Testing.
  assert.ok(existsSync(new URL("../src/app/privacy/page.tsx", import.meta.url)));
  assert.ok(existsSync(new URL("../src/app/terms/page.tsx", import.meta.url)));
  assert.match(read("src/app/privacy/page.tsx"), /canonical: "\/privacy"/);
  assert.match(read("src/app/terms/page.tsx"), /canonical: "\/terms"/);
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

test("both documents can be found from every page and from sign-in", () => {
  const footer = read("src/components/marketing/MarketingLayout.tsx");
  assert.match(footer, /href="\/privacy"/);
  assert.match(footer, /href="\/terms"/);
  const login = read("src/app/login/page.tsx");
  assert.match(login, /By continuing, you agree to the/);
  assert.ok(allText(termsOfService).includes("Privacy Policy"), "the terms point to the privacy policy");
});
