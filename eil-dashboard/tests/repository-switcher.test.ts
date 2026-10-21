/*
 * The repository switcher in the header (2026-10-21): the name opens the
 * reader's repositories, and choosing one keeps the reader on the same page.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FILTER_FROM, RepositoryMenu, switchTarget } from "../src/components/workspace/RepositorySwitcher";

void React;

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const PROJECTS = [
  { id: "p1", name: "testtest", organization_id: "o1" },
  { id: "p2", name: "Pipeline check (EIL)", organization_id: "o1" },
  { id: "p3", name: "Test 2", organization_id: "o1" },
];

test("a switch keeps the page and its section, and drops what belonged to the old repository", () => {
  assert.equal(switchTarget("/workspace/dashboard", "?tab=adaptive&repo=p1&q=writing"), "/workspace/dashboard?tab=adaptive");
  assert.equal(switchTarget("/workspace/settings", "?section=repository"), "/workspace/settings?section=repository");
  assert.equal(switchTarget("/workspace/library", "?paperId=12&tab=preview&folder=f1"), "/workspace/library?tab=preview");
  assert.equal(switchTarget("/workspace/chat", "?q=hello"), "/workspace/chat");
  assert.equal(switchTarget("/workspace/home", ""), "/workspace/home");
  // Off the workspace pages (the repository picker itself), a switch opens the repository's Home.
  assert.equal(switchTarget("/workspaces", ""), "/workspace/home");
});

test("closed, the header shows the repository's name with a chevron, and says it switches", () => {
  const html = renderToStaticMarkup(createElement(RepositoryMenu, { projects: PROJECTS, currentId: "p1", currentName: "testtest", onSelect: () => undefined }));
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-label="Repository: testtest\. Switch repository"/);
  assert.match(html, />testtest</);
  assert.match(html, /<svg/, "the chevron");
  assert.doesNotMatch(html, /Your repositories/, "the list is not drawn until opened");
  const none = renderToStaticMarkup(createElement(RepositoryMenu, { projects: PROJECTS, currentId: null, currentName: "", onSelect: () => undefined }));
  assert.match(none, />Select repository</);
});

test("open, it lists every repository, marks the open one, and links to all of them", () => {
  const html = renderToStaticMarkup(createElement(RepositoryMenu, { projects: PROJECTS, currentId: "p2", currentName: "Pipeline check (EIL)", onSelect: () => undefined, defaultOpen: true }));
  assert.match(html, /aria-expanded="true"/);
  for (const project of PROJECTS) assert.match(html, new RegExp(`data-repository="${project.id}"`));
  assert.equal((html.match(/aria-current="true"/g) ?? []).length, 1);
  assert.match(html, /data-repository="p2" aria-current="true"/);
  assert.match(html, /href="\/workspaces"[^>]*>.*All repositories/);
  assert.doesNotMatch(html, /Find a repository/, "a short list needs no filter");
});

test("a long list opens with a filter, and repositories in several organizations are grouped", () => {
  const many = Array.from({ length: FILTER_FROM }, (_, index) => ({ id: `r${index}`, name: `Repository ${index}`, organization_id: index < 4 ? "o1" : "o2" }));
  const html = renderToStaticMarkup(
    createElement(RepositoryMenu, {
      projects: many,
      organizations: [{ id: "o1", name: "Personal" }, { id: "o2", name: "Faculty of Arts" }],
      currentId: "r0",
      currentName: "Repository 0",
      onSelect: () => undefined,
      defaultOpen: true,
    })
  );
  assert.match(html, /placeholder="Find a repository"/);
  assert.match(html, />Personal</);
  assert.match(html, />Faculty of Arts</);
});

test("the header's breadcrumb is the switcher, on wide screens and in the phone drawer", () => {
  const shell = read("src/components/workspace/WorkspaceShell.tsx");
  assert.match(shell, /<RepositorySwitcher onNavigate=\{onNavigate\} onDone=\{onDone\} \/>/);
  assert.match(shell, /<WorkspaceBreadcrumb onNavigate=\{handleNavigate\} \/>/);
  assert.match(shell, /onDone=\{onClose\}/, "the drawer closes after a switch");
  const switcher = read("src/components/workspace/RepositorySwitcher.tsx");
  assert.match(switcher, /setSelectedProjectId\(projectId\)/);
  assert.match(switcher, /event\.key === "ArrowDown"/);
  assert.match(switcher, /event\.key !== "Escape"/);
});
