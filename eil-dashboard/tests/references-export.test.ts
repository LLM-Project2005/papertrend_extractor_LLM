import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { vector } from "@electric-sql/pglite-pgvector";
import {
  apaReference,
  citationFromCrossref,
  citationFromPaper,
  doiFromYearSource,
  plausibleAuthor,
  primaryDoiFromText,
  strictTitleMatch,
  titleSimilarity,
  toAPA,
  toBibTeX,
  toRIS,
  type CitationRecord,
  type CrossrefWork,
} from "../src/lib/references/citation";
import {
  CITATION_CACHE_VERSION,
  crossrefConcurrency,
  fetchCrossrefJson,
  loadReferencePapers,
  resolveReferences,
  saveCitationCacheIn,
} from "../src/lib/references/resolve";
import { paperIdFromRunId } from "../src/lib/paper-id";
import { privacyPolicy } from "../src/lib/legal-content";
import type { ReactNode } from "react";
import { routeHarness } from "./support/route-harness";
import { captured, elementsOf, headlessRoot, textOf } from "./support/stub-smallfix-root";

/*
 * Selected papers, or a repository, export as BibTeX, RIS and APA (docs/32,
 * 4.4). The export route runs against PGlite under the app's role
 * (tests/support/route-harness.ts), and the dialog runs its effects through
 * React's client renderer without a document (stub-smallfix-root.ts).
 */

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const WORK: CrossrefWork = {
  DOI: "10.1016/J.JSLW.2019.01.002",
  type: "journal-article",
  title: ["Peer Feedback in EFL Writing Classrooms"],
  author: [
    { family: "Srisuk", given: "Anong" },
    { family: "Le", given: "Jean-Luc Minh" },
  ],
  "container-title": ["Journal of Second Language Writing"],
  volume: "44",
  issue: "2",
  page: "12-30",
  publisher: "Elsevier BV",
  "published-print": { "date-parts": [[2019, 6]] },
};

/* ---------------------------------------------------------------- finding */

test("the paper's own DOI is found on its first pages, never one from its references", () => {
  assert.equal(primaryDoiFromText("Journal 12(2). doi: 10.1016/j.jslw.2019.01.002.\nAbstract ..."), "10.1016/j.jslw.2019.01.002");
  assert.equal(
    primaryDoiFromText(`Title\nAbstract text.\nReferences\nSmith (2010). doi:10.1000/ref.one\nLee (2011). doi:10.1000/ref.two`),
    null,
    "DOIs after the References heading belong to other papers"
  );
  assert.equal(primaryDoiFromText("10.1000/a and 10.1000/b without labels"), null, "two unlabelled DOIs are ambiguous");
  assert.equal(doiFromYearSource("web:crossref:doi:10.1016/J.JSLW.2019.01.002"), "10.1016/j.jslw.2019.01.002");
  assert.equal(doiFromYearSource("pdf_front_matter"), null);
});

test("titles are compared as the worker's year lookup compares them", () => {
  // Reference values from nodes/year_web_lookup.py _title_similarity.
  const pairs: Array<[string, string, number]> = [
    ["Peer feedback in EFL writing classrooms", "Peer Feedback in EFL Writing Classrooms: A Review", 0.837931],
    ["The effects of extensive reading on vocabulary", "Effects of extensive reading on vocabulary growth", 0.830526],
    ["Abc", "Xyz", 0],
    ["Teaching pronunciation to Thai learners of English", "Teaching pronunciation to Thai learners of English", 1],
  ];
  for (const [left, right, expected] of pairs) assert.ok(Math.abs(titleSimilarity(left, right) - expected) < 1e-6, `${left} / ${right}`);
});

test("only the one Crossref result that is this paper is taken", () => {
  const title = "Peer feedback in EFL writing classrooms";
  const other: CrossrefWork = { title: ["Peer feedback in ESL speaking classrooms"], issued: { "date-parts": [[2019]] } };
  assert.equal(strictTitleMatch(title, "2019", [other, WORK]), WORK, "an exact title");
  assert.equal(strictTitleMatch(title, "2012", [WORK]), null, "a year two or more apart is another edition");
  assert.equal(strictTitleMatch(title, null, [other]), null, "a near title is not enough");
  assert.equal(strictTitleMatch("Short title", null, [{ title: ["Short title"] }]), null, "too short to match safely");
});

/* ---------------------------------------------------------------- records */

test("Crossref's details fill the reference; a reader's correction wins", () => {
  const record = citationFromCrossref(WORK, { title: "Peer feedback in EFL writing classrooms", year: "2019" });
  assert.equal(record.type, "article");
  assert.equal(record.title, "Peer Feedback in EFL Writing Classrooms");
  assert.equal(record.doi, "10.1016/j.jslw.2019.01.002");
  assert.equal(record.pages, "12-30");
  assert.equal(record.source, "crossref");
  const corrected = citationFromCrossref(WORK, { title: "x", year: "2019", correctedTitle: "My corrected title", correctedYear: "2020" });
  assert.equal(corrected.title, "My corrected title");
  assert.equal(corrected.year, "2020");
  const bare = citationFromPaper({ title: "A thesis Crossref does not know", year: "Unknown" });
  assert.deepEqual([bare.source, bare.year, bare.authors.length], ["paper", null, 0]);
});

const ARTICLE: CitationRecord = citationFromCrossref(WORK, { title: null, year: null });

test("BibTeX: typed entries, unique keys, escaped text, the title's capitals kept", () => {
  const thesis = citationFromPaper({ title: "Feedback & revision: 100% of_drafts", year: "2021" });
  const bib = toBibTeX([ARTICLE, ARTICLE, thesis]);
  assert.match(bib, /^@article\{srisuk2019peer,\n  author = \{Srisuk, Anong and Le, Jean-Luc Minh\},\n  title = \{\{Peer Feedback in EFL Writing Classrooms\}\},\n  journal = \{Journal of Second Language Writing\},\n  year = \{2019\},\n  volume = \{44\},\n  number = \{2\},\n  pages = \{12--30\},\n  publisher = \{Elsevier BV\},\n  doi = \{10\.1016\/j\.jslw\.2019\.01\.002\},\n\}/);
  assert.match(bib, /@article\{srisuk2019peera,/, "a second paper with the same key gets a letter");
  assert.match(bib, /@misc\{anon2021feedback,\n  title = \{\{Feedback \\& revision: 100\\% of\\_drafts\}\},\n  year = \{2021\},\n  note = \{Authors and venue not found; title and year from the paper\},\n\}/);
});

test("RIS: one tagged block per paper, ending ER", () => {
  const ris = toRIS([ARTICLE, citationFromPaper({ title: "Untraced paper", year: "2018" })]);
  const first = ris.split("\r\n\r\n")[0].split("\r\n");
  assert.deepEqual(first, [
    "TY  - JOUR",
    "AU  - Srisuk, Anong",
    "AU  - Le, Jean-Luc Minh",
    "TI  - Peer Feedback in EFL Writing Classrooms",
    "T2  - Journal of Second Language Writing",
    "PY  - 2019",
    "VL  - 44",
    "IS  - 2",
    "SP  - 12",
    "EP  - 30",
    "PB  - Elsevier BV",
    "DO  - 10.1016/j.jslw.2019.01.002",
    "UR  - https://doi.org/10.1016/j.jslw.2019.01.002",
    "ER  -",
  ]);
  assert.match(ris, /TY  - GEN\r\nTI  - Untraced paper\r\nPY  - 2018\r\nN1  - Authors and venue not found; title and year from the paper\.\r\nER  -\r\n$/);
});

test("APA 7: authors with initials and &, the year, the source, the DOI; no author puts the title first", () => {
  assert.equal(
    apaReference(ARTICLE),
    "Srisuk, A., & Le, J.-L. M. (2019). Peer Feedback in EFL Writing Classrooms. Journal of Second Language Writing, 44(2), 12–30. https://doi.org/10.1016/j.jslw.2019.01.002"
  );
  assert.equal(apaReference(citationFromPaper({ title: "A paper with no known author", year: null })), "A paper with no known author. (n.d.).");
  const chapter: CitationRecord = { ...ARTICLE, type: "chapter", container: "Handbook of Writing", authors: [{ family: "Kim", given: "Soo" }], doi: null };
  assert.equal(apaReference(chapter), "Kim, S. (2019). Peer Feedback in EFL Writing Classrooms. In Handbook of Writing (pp. 12–30). Elsevier BV.");
  const many = { ...ARTICLE, authors: Array.from({ length: 22 }, (_, index) => ({ family: `Author${index + 1}`, given: "A" })) };
  assert.match(apaReference(many), /^Author1, A\., .*Author19, A\., \. \. \. Author22, A\. \(2019\)/);
  // The list is sorted by first author.
  const list = toAPA([ARTICLE, chapter]).split("\n\n");
  assert.ok(list[0].startsWith("Kim, S."));
});

test("affiliations, emails and titles deposited as authors are left out; real names stay", () => {
  // As one Thai journal deposited a paper's authors in Crossref (found on the test repository).
  const work: CrossrefWork = {
    ...WORK,
    author: [
      { name: "Chulalongkorn University, Bangkok, Thailand" },
      { family: "arthitaya.n@litu.tu.ac.th" },
      { family: "Narathakoon", given: "Arthitaya" },
      { family: "Asst. Prof." },
      { family: "Sapsirin", given: "Sutthirak" },
      { family: "Ph.D." },
      { family: "Subphadoongchone", given: "Pramarn" },
    ],
  };
  const record = citationFromCrossref(work, { title: null, year: null });
  assert.deepEqual(record.authors.map((author) => author.family), ["Narathakoon", "Sapsirin", "Subphadoongchone"]);
  for (const name of [{ family: "Drew", given: "Nancy" }, { family: "Van der Berg", given: "Jan" }, { family: "Le", given: "Jean-Luc Minh" }]) {
    assert.equal(plausibleAuthor(name), true, name.family);
  }
});

test("Crossref is asked one paper at a time without a contact address, and a 429 is waited out once", async () => {
  const previous = process.env.CROSSREF_MAILTO;
  delete process.env.CROSSREF_MAILTO;
  assert.equal(crossrefConcurrency(), 1);
  process.env.CROSSREF_MAILTO = "ops@example.org";
  assert.equal(crossrefConcurrency(), 3);
  if (previous === undefined) delete process.env.CROSSREF_MAILTO;
  else process.env.CROSSREF_MAILTO = previous;

  const statuses = [429, 200];
  const waits: number[] = [];
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ message: WORK }), { status: statuses.shift() ?? 200, headers: { "retry-after": "2" } })) as unknown as typeof fetch;
  const payload = (await fetchCrossrefJson("https://api.crossref.org/works/x", { fetchImpl, wait: async (ms) => void waits.push(ms) })) as { message: CrossrefWork };
  assert.equal(payload.message.DOI, WORK.DOI);
  assert.deepEqual(waits, [2000]);
  const always429 = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
  await assert.rejects(fetchCrossrefJson("https://api.crossref.org/works/x", { fetchImpl: always429, wait: async () => undefined }), /429/);
  const missing = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
  assert.equal(await fetchCrossrefJson("https://api.crossref.org/works/x", { fetchImpl: missing }), null);
});

/* --------------------------------------------------------- the lookups */

function row(runId: string, overrides: Partial<{ input_payload: Record<string, unknown>; paper_title: string; paper_year: string; year_source: string; front: string }> = {}) {
  return {
    run_id: runId,
    input_payload: overrides.input_payload ?? {},
    paper_title: overrides.paper_title ?? "Peer feedback in EFL writing classrooms",
    paper_year: overrides.paper_year ?? "2019",
    year_source: overrides.year_source ?? null,
    front: overrides.front ?? null,
  };
}

test("lookups go by DOI, then title; each answer is kept, a failed lookup is not", async () => {
  const urls: string[] = [];
  const fetchJson = async (url: string) => {
    urls.push(url);
    if (url.includes("/works/10.1016")) return { message: WORK };
    if (url.includes("query.bibliographic=Peer")) return { message: { items: [WORK] } };
    if (url.includes("broken")) throw new Error("Crossref is down");
    return { message: { items: [] } };
  };
  const resolved = await resolveReferences(
    [
      row("r1", { year_source: "web:crossref:doi:10.1016/j.jslw.2019.01.002" }),
      row("r2"),
      row("r3", { paper_title: "An unpublished Thai master's thesis on reading" }),
      row("r4", { paper_title: "A broken lookup for this long title here" }),
    ],
    { fetchJson, concurrency: 1 }
  );
  assert.equal(resolved.fromCrossref, 2);
  assert.equal(resolved.titleOnly, 1);
  assert.equal(resolved.notLookedUp, 1);
  assert.ok(urls[0].endsWith("/works/10.1016%2Fj.jslw.2019.01.002"), "by DOI first");
  assert.deepEqual(resolved.cacheWrites.map((write) => [write.runId, write.cache.status]), [["r1", "found"], ["r2", "found"], ["r3", "none"]]);
  assert.equal(resolved.records[3].source, "paper");
});

test("a kept answer is used without asking again, until the title it was found for changes", async () => {
  let calls = 0;
  const fetchJson = async () => {
    calls += 1;
    return { message: { items: [] } };
  };
  const cache = { v: CITATION_CACHE_VERSION, basis: "peer feedback in efl writing classrooms|", status: "found", work: WORK, checkedAt: new Date().toISOString() };
  const kept = await resolveReferences([row("r1", { input_payload: { citation: cache } })], { fetchJson });
  assert.equal(calls, 0);
  assert.equal(kept.records[0].authors.length, 2);
  const retitled = await resolveReferences([row("r1", { input_payload: { citation: cache, user_overrides: { title: "A corrected, different title for the paper" } } })], { fetchJson });
  assert.equal(calls, 1, "a corrected title is looked up afresh");
  assert.equal(retitled.records[0].title, "A corrected, different title for the paper");
  // A paper Crossref did not know is asked about again after 30 days.
  const old = { ...cache, status: "none", work: undefined, checkedAt: "2000-01-01T00:00:00Z" };
  await resolveReferences([row("r1", { input_payload: { citation: old } })], { fetchJson });
  assert.equal(calls, 2);
});

test("past the deadline, the rest are exported with title and year and looked up next time", async () => {
  let clock = 0;
  const resolved = await resolveReferences([row("r1"), row("r2"), row("r3")], {
    fetchJson: async () => {
      clock += 20_000;
      return { message: { items: [] } };
    },
    now: () => clock,
    deadlineMs: 25_000,
    concurrency: 1,
  });
  assert.equal(resolved.notLookedUp, 1);
  assert.equal(resolved.cacheWrites.length, 2);
});

test("papers load for the owner only, and a kept lookup leaves the run's modified date alone", async () => {
  const db = new PGlite({ extensions: { vector, pgcrypto } });
  await db.exec(read("cloudsql/schema.sql"));
  const client = { query: (text: string, params?: unknown[]) => db.query(text, params) } as never;
  const owner = "00000000-0000-0000-0000-00000000000a";
  const other = "00000000-0000-0000-0000-00000000000b";
  const run = "1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51";
  const otherRun = "2a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c52";
  await db.exec(`
    INSERT INTO user_profiles (id, email) VALUES ('${owner}', 'o@example.edu'), ('${other}', 'x@example.edu');
    INSERT INTO ingestion_runs (id, owner_user_id, source_type, status, input_payload, updated_at) VALUES
      ('${run}', '${owner}', 'upload', 'succeeded', '{"user_overrides": {"year": "2020"}}', '2026-01-01T00:00:00Z'),
      ('${otherRun}', '${other}', 'upload', 'succeeded', '{}', '2026-01-01T00:00:00Z');
  `);
  for (const [id, who] of [[run, owner], [otherRun, other]]) {
    const paper = paperIdFromRunId(id);
    await db.query(`INSERT INTO papers (id, owner_user_id, year, title, year_source) VALUES ($1, $2, '2019', 'Peer feedback', 'web:crossref:doi:10.1/x')`, [paper, who]);
    await db.query(`INSERT INTO paper_content (paper_id, owner_user_id, ingestion_run_id, raw_text) VALUES ($1, $2, $3, $4)`, [paper, who, id, "doi: 10.1/x " + "x".repeat(9000)]);
  }
  const rows = await loadReferencePapers(client, owner, { runIds: [run, otherRun] });
  assert.deepEqual(rows.map((item) => item.run_id), [run], "another owner's paper is never loaded");
  assert.equal(rows[0].front?.length, 8000, "only the first pages are read");
  await saveCitationCacheIn(client, owner, [{ runId: run, cache: { v: 1, basis: "b", status: "none", checkedAt: "2026-10-02T00:00:00Z" } }]);
  const after = await db.query<{ citation: { status: string }; overrides: { year: string }; updated_at: Date }>(
    `SELECT input_payload->'citation' AS citation, input_payload->'user_overrides' AS overrides, updated_at FROM ingestion_runs WHERE id = $1`,
    [run]
  );
  assert.equal(after.rows[0].citation.status, "none");
  assert.equal(after.rows[0].overrides.year, "2020", "the rest of the payload stays");
  assert.equal(new Date(after.rows[0].updated_at).toISOString(), "2026-01-01T00:00:00.000Z");
  await db.close();
});

/* ------------------------------------------------------------ the export */

const OWNER = "00000000-0000-4000-8000-00000000000a";
const PROJECT = "00000000-0000-4000-8000-0000000000a1";

test("a repository's references are its own finished papers, and a selection's are the papers chosen", async () => {
  const harness = await routeHarness();
  const owner = await harness.signIn(OWNER);
  const other = await harness.signIn("00000000-0000-4000-8000-00000000000b");
  const OTHER_PROJECT = "00000000-0000-4000-8000-0000000000a2";
  await harness.db.exec(`
    INSERT INTO workspace_organizations (id, owner_user_id, name) VALUES ('00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Org');
    INSERT INTO workspace_projects (id, organization_id, owner_user_id, name, analysis_profile, analysis_profile_version, analysis_profile_hash, analysis_profile_updated_at) VALUES
      ('${PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Assessment', '{}'::jsonb, 2, 'test', now()),
      ('${OTHER_PROJECT}', '00000000-0000-4000-8000-0000000000c1', '${OWNER}', 'Phonology', '{}'::jsonb, 2, 'test', now());
    INSERT INTO research_folders (id, owner_user_id, name, project_id) VALUES
      ('00000000-0000-4000-8000-0000000000f1', '${OWNER}', 'A', '${PROJECT}'),
      ('00000000-0000-4000-8000-0000000000f2', '${OWNER}', 'B', '${OTHER_PROJECT}');
  `);
  const paper = async (run: string, folder: string, title: string, status = "succeeded", trashed = false) => {
    await harness.db.query(
      `INSERT INTO ingestion_runs (id, owner_user_id, folder_id, source_type, status, trashed_at) VALUES ($1, $2, $3, 'upload', $4, CASE WHEN $5 THEN now() END)`,
      [run, OWNER, folder, status, trashed]
    );
    const id = paperIdFromRunId(run);
    await harness.db.query(`INSERT INTO papers (id, owner_user_id, folder_id, year, title) VALUES ($1, $2, $3, '2019', $4)`, [id, OWNER, folder, title]);
    await harness.db.query(`INSERT INTO paper_content (paper_id, owner_user_id, folder_id, ingestion_run_id, raw_text) VALUES ($1, $2, $3, $4, 'Abstract only.')`, [id, OWNER, folder, run]);
  };
  const runs = ["1a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c51", "2a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c52", "3a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c53", "4a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c54", "5a2b3c4d-e5f6-4a7b-8c9d-0e1f2a3b4c55"];
  await paper(runs[0], "00000000-0000-4000-8000-0000000000f1", "Peer feedback in EFL writing classrooms");
  await paper(runs[1], "00000000-0000-4000-8000-0000000000f1", "Washback of a national English test");
  await paper(runs[2], "00000000-0000-4000-8000-0000000000f1", "A paper still being read", "processing");
  await paper(runs[3], "00000000-0000-4000-8000-0000000000f1", "A paper put in Trash", "succeeded", true);
  await paper(runs[4], "00000000-0000-4000-8000-0000000000f2", "Vowel length in Thai learners' English");

  // Crossref knows none of them here; nothing leaves the process.
  const asked: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    assert.ok(url.startsWith("https://api.crossref.org/"), url);
    asked.push(url);
    return Response.json({ message: { items: [] } });
  }) as typeof fetch;
  try {
    const { POST } = await import("../src/app/api/workspace/library/references/route");
    const cite = async (body: unknown, headers = owner) => {
      const response = await POST(harness.request("/api/workspace/library/references", { headers, body }));
      return { status: response.status, body: (await response.json()) as { records?: CitationRecord[]; titleOnly?: number; error?: string } };
    };
    const repository = await cite({ projectId: PROJECT });
    assert.equal(repository.status, 200);
    assert.deepEqual(repository.body.records?.map((record) => record.title), ["Peer feedback in EFL writing classrooms", "Washback of a national English test"]);
    assert.equal(repository.body.titleOnly, 2);
    assert.ok(asked.length >= 2, "each was looked up");
    const chosen = await cite({ runIds: [runs[1], runs[4]] });
    assert.deepEqual(chosen.body.records?.map((record) => record.title), ["Vowel length in Thai learners' English", "Washback of a national English test"]);
    assert.equal((await cite({ projectId: PROJECT }, other)).status, 404, "another person's request finds none of them");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the references dialog writes the papers it was sent in the format chosen", async () => {
  const records = [ARTICLE, citationFromPaper({ title: "Untraced paper", year: "2018" })];
  const sent: Array<{ url: string; body: unknown; authorization: string | null }> = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input), body: JSON.parse(String(init?.body)), authorization: new Headers(init?.headers).get("authorization") });
    return Response.json({ records, fromCrossref: 1, titleOnly: 1, notLookedUp: 0 });
  }) as typeof fetch;
  const { default: ReferencesDialog } = await import("../src/components/admin/ReferencesDialog");
  const root = await headlessRoot();
  let tree: ReactNode = null;
  try {
    await root.render(
      captured(ReferencesDialog, { selection: { projectId: PROJECT }, label: "Assessment", headers: { Authorization: "Bearer reader-token" }, onClose: () => undefined }, (next) => (tree = next))
    );
    await root.act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    assert.deepEqual(sent, [{ url: "/api/workspace/library/references", body: { projectId: PROJECT }, authorization: "Bearer reader-token" }]);
    const shown = () => elementsOf(tree).find((element) => element.type === "textarea")?.props.value;
    const status = elementsOf(tree).find((element) => element.props.role === "status");
    assert.match(textOf(status), /^1 of 2 with authors and venue from Crossref; 1 with title and year only/);
    assert.equal(shown(), toBibTeX(records), "BibTeX first");
    const press = (label: string) => {
      const button = elementsOf(tree).find((element) => element.type === "button" && textOf(element) === label);
      return root.act(() => (button?.props.onClick as () => void)());
    };
    await press("RIS");
    assert.equal(shown(), toRIS(records));
    await press("APA");
    assert.equal(shown(), toAPA(records));
  } finally {
    await root.unmount();
    globalThis.fetch = realFetch;
  }
});

test("the privacy policy says what Crossref and OpenAlex are sent", () => {
  // The Library's Cite and Export references buttons are run in small-fixes-behaviour-library.test.ts.
  const policy = privacyPolicy.sections.flatMap((section) => [...(section.paragraphs ?? []), ...(section.bullets ?? [])]).join(" ");
  assert.match(policy, /Crossref and OpenAlex receive paper titles or DOIs only/);
});
