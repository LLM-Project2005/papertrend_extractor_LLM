# 27 — Site-wide UI quality audit and remediation

Status: **in progress** (opened 2026-09-23)

## Why this exists

Every previous improvement round in this project targeted one feature: the chat page
(doc 25), the semantic map, the visualization agent. This round targets the *site* —
every page a person can reach, public and authenticated — and asks a different question:
not "is this correct?" but "does this feel like something a researcher would trust and
want to use?"

The brief was to find design flaws, elements that serve no purpose, and UI that reads as
generated rather than designed; and to make it better **without changing the brand**.

## What the brand is, and what it is not

The distinction matters, because "make it more beautiful" and "keep the same CI" pull
against each other unless the line is drawn explicitly. Everything below is derived from
the code, not invented.

**The brand — preserve, do not touch:**

| Element | Value |
| --- | --- |
| Palette | Monochrome. Light mode uses Tailwind `slate-*`; dark mode uses near-black surfaces and near-white text |
| Dark surfaces | `#050505` panel, `#030303` recessed, `#0a0a0a` raised, `#1f1f1f` border |
| Dark text | `#f2f2f2` body, `#a3a3a3` muted, `#8f8f8f` label |
| Track accents | `el #4a7fe5`, `eli #e05c5c`, `lae #3cba83`, `other #9b7fd4` — the only saturated colour with meaning |
| Radii | `--radius-control: 8px`, `--radius-panel: 12px` |
| Motion | `--motion-fast: 140ms`, `--motion-ui: 220ms`, `--ease-out-expo` |
| Type accent | Monospace, uppercase, tracked — used for eyebrows and field labels |
| Surfaces | `.app-surface`, `.app-card`, `.app-muted`, `.tab-btn` |

**Not the brand — accidents that accumulated:**

- Seven near-identical greys (`#8f8f8f`, `#8e8e8e`, `#9c9c9c`, `#9b9b9b`, `#a3a3a3`,
  `#a1a1a1`, `#888888`) where the brand means one.
- Five near-whites, six near-blacks, in the same pattern.
- `#007cf0`, `#00dfd8`, `#ff0080`, `#f9cb28`, `#7928ca` — the stock Vercel template
  gradient palette. These carry no product meaning and appear nowhere in the real app.
- Fabricated numbers used as decoration.

A change that removes a seventh redundant grey preserves the brand. A change that makes
the palette colourful would not. That is the line.

## Method

1. **Rendered evidence.** `scripts/capture-ui.ts` drives Chromium over every route at
   390 / 768 / 1440 px, in both themes where theme bugs are likely, signed in for the
   authenticated pages. It records a full-page screenshot and a diagnostics record read
   from *computed* styles in the live page — the colour that won the cascade, the
   background actually painted behind the text, the box the element actually occupies.

   This matters because every previous checker in this repo that parsed `className`
   strings was wrong about something. A class does not tell you what the cascade
   resolved, what the inherited background was, or whether the element was visible.

2. **Source investigation.** Ten independent lenses over the source, each required to
   cite `file:line` and quote the code. The highest-stakes claims are then handed to a
   sceptic whose job is to refute them.

3. **Plan before edit.** Findings are triaged and the architectural choices are argued
   out in this document before any file is changed.

### Three harness bugs worth recording

The measuring instrument was wrong three times before it was right. Each would have
produced confident, wrong findings, so each is recorded.

**1. Jump-scrolling hid half the page.** The first run scrolled straight to the bottom
before screenshotting. Reveal animations are driven by an `IntersectionObserver`, so the
middle of the page never intersected and stayed at `opacity: 0`. The landing-page
screenshot came back with two enormous blank bands — which looks exactly like a serious
layout defect. Fix: walk down a screen at a time. Elements left at `opacity: 0` are also
skipped by the visibility check, so that run's contrast and tap-target counts had silent
coverage holes.

**2. `storageState` does not carry a Firebase session.** Playwright's saved state covers
cookies and `localStorage`; Firebase Auth keeps its session in IndexedDB. Handing that
state to a fresh context produced a signed-out browser, so **every authenticated route
screenshotted the login page** — the entire product surface, silently missing, while the
run reported HTTP 200 for all of it. Fix: one context per viewport+theme, signed in once
and reused across routes, plus an explicit `*** BOUNCED TO LOGIN ***` marker in the log so
this can never pass unnoticed again.

**3. Elements measured mid-transition read as contrast failures.** A node caught halfway
through a fade has fractional opacity, which blends toward its background. Several pages
reported exactly one contrast failure that vanished when re-measured in a settled state.
Fix: await `document.getAnimations()` before measuring, capped at 2.5 s because the
marketing grid and scanline loop forever and would never resolve.

The pattern across all three: the instrument reported a clean, plausible number while
measuring the wrong thing. Any contrast finding below is re-checked in a settled state
before it is acted on.

## Acceptance criteria

Work is not finished until every line below is met or explicitly waived with a reason.

### A. Correctness — things that are measurably wrong

| # | Criterion | How it is measured |
| --- | --- | --- |
| A1 | No text below WCAG AA contrast (4.5:1 body, 3:1 large) on any page, viewport or theme | `capture-ui.ts` diagnostics, computed styles |
| A2 | No interactive target smaller than 24×24 px | same |
| A3 | No horizontal page overflow at 390 px | same |
| A4 | No console error on any page load | same |
| A5 | Every colour utility written without a `dark:` prefix either has a light-mode translation or is a deliberate both-theme accent | source scan |
| A6 | Every image has an `alt`; every icon-only control has an accessible name | diagnostics |
| A7 | One `h1` per page, heading levels descend without skipping | diagnostics |

### B. Honesty — things that mislead

| # | Criterion |
| --- | --- |
| B1 | No fabricated statistic is presented to a visitor as product performance |
| B2 | No internal implementation detail appears in user-facing copy |
| B3 | Any product illustration either shows the real product or is unmistakably an illustration |
| B4 | Hostnames, product names and terminology are consistent across marketing, docs and app |

### C. Purpose — things that should not be there

| # | Criterion |
| --- | --- |
| C1 | No component shipped to the browser that nothing renders |
| C2 | Every decorative element can be justified in one sentence, or it goes |
| C3 | No control that looks interactive and is not, and none that duplicates its neighbour |
| C4 | Perpetual animation on a reading surface is removed or bounded |

### D. Coherence — the brand applied consistently

| # | Criterion |
| --- | --- |
| D1 | Near-identical greys/whites/blacks consolidated to one token each, with no intended visual change beyond improved contrast |
| D2 | The stock template gradient palette removed from product surfaces |
| D3 | One theming strategy per surface, not two |
| D4 | Controls of the same role share one implementation or one documented variant set |

### E. Safety — the work must not harm the site

| # | Criterion |
| --- | --- |
| E1 | Test suite green, at or above the 561-test baseline |
| E2 | `next build` succeeds |
| E3 | Every change verified on the deployed site before the round is called done |
| E4 | No change to authorization, data access, or anything in the handoff's "never" list |

## Options considered before implementing

The brief was explicit that complex changes should be planned and alternatives weighed
before any file is edited. The three decisions below are the ones where the obvious fix is
not the right one.

### Decision 1 — what to do about the fabricated product mock (F1)

| Option | Argument for | Argument against |
| --- | --- | --- |
| A. Real screenshots | Most persuasive; what mature products do | Needs real data. The test workspace holds synthetic seed data, and using a real user's library on a public page is a privacy problem. Images add weight and go stale silently |
| B. Render the real app components with sample data | Always in sync, no assets | Couples the marketing bundle to app internals, and still needs invented sample data — the honesty problem returns wearing a better coat |
| C. Keep an illustration, make it honest | Keeps the visual interest; smallest change; removes the false claims | Still an abstraction rather than the product |
| D. Delete it | Unambiguous | Removes the page's only visual; a researcher deciding whether to sign up gets less, not more |

**Chosen: C, sharpened.** The illustration stays, but stops lying: the fake hostname
`research-trend-analysis.web.app` goes, the invented percentages go, and the stage names
become the *real* pipeline stages from `graphs.py` — extract, clean, translate, segment,
metadata, keywords, topics, tracks, typology, facets. That converts a fabrication into a
true and more specific statement about the product, with no new assets and no privacy
exposure. The palette moves to brand at the same time.

### Decision 2 — how far to go on colour (F3, D1)

| Option | Argument for | Argument against |
| --- | --- | --- |
| A. Full semantic token system, migrate ~2300 usages | Correct end state | Enormous diff across every file; high regression risk; unverifiable by eye |
| B. Convert the 330 unprefixed marketing utilities to `dark:` pairs and delete the override layer | Removes the fragile translation layer; one strategy per surface | ~330 edits in 5 files, and it rewrites code that currently *works* |
| C. Collapse near-identical hexes to canonical values only | Mechanical, tiny perceptual change, verifiable by colour histogram | Leaves the two-strategy problem in place |
| D. Fix only what measurably fails, then document the canonical palette | Smallest safe change | Leaves known fragility |

**Deferred until the diagnostics land.** The override layer is fragile in principle, but
fragile-in-principle is not the same as broken-in-fact. If the light-mode marketing pages
come back with no contrast failures and no visual defects, rewriting 330 working
declarations is churn dressed up as rigour, and it carries real risk of breaking a surface
that is currently fine. The measured result decides between B and C/D — not the elegance of
the argument. Whatever is chosen, the near-duplicate greys collapse (C) because that is
cheap, safe and independently worthwhile.

### Decision 3 — how far to go on control consistency (F7)

| Option | Argument for | Argument against |
| --- | --- | --- |
| A. Extract `Button`/`Card`/`Input` primitives and migrate all 115 + 437 call sites | The real fix | Very large diff; every migrated site is a chance to change behaviour by accident; hard to verify |
| B. Normalise the *values* in place — radii to the two brand tokens, heights to three steps | Keeps every call site and its behaviour; purely visual; mechanically verifiable | Does not stop the next component inventing a ninth height |
| C. B, plus a documented control spec for new code | Adds the guard rail without the migration risk | Relies on the spec being read |

**Chosen: C.** A user perceives *inconsistency*, not *duplication* — two buttons side by
side with 8px and 16px corners look wrong; two buttons sharing a class string do not look
right merely for sharing it. B delivers the whole user-visible benefit at a fraction of
A's risk, and it can be verified by re-measuring computed border-radius and height across
the site. The abstraction can follow later, when it is not competing with a deadline for
attention.

## Findings

*(filled in as investigation completes)*

### Confirmed by direct measurement

| # | Finding | Evidence | Severity |
| --- | --- | --- | --- |
| F1 | The landing page presents an entirely fabricated product mock — fake window chrome `analysis.run/webquest.pdf`, six bars representing nothing, invented percentages (96/88/74/91%), and a fake hostname `research-trend-analysis.web.app`. None of it corresponds to a real Papertrend screen. | `src/components/marketing/FeatureShowcases.tsx:56-125`, `MarketingMotion.tsx:36-90` | High |
| F2 | `"Static marketing pages with client-only auth CTA"` ships on the public landing page as the fourth reason to choose Papertrend. It is a build note. | `src/components/marketing/marketing-content.ts` `valuePillars[3]` | High |
| F3 | 330 of 369 colour utilities on marketing surfaces are written as dark values with no `dark:` prefix, relying on a CSS layer that translates specific hex classes for light mode. 53 occurrences have no translation rule at all. `MarketingLayout.tsx` uses the correct `dark:` strategy — two incompatible approaches on one surface. | `src/app/globals.css:176-231`, marketing components | High |
| F4 | On `/login`, "Create password account" (136×16 px) and "Reset password" (84×16 px) are 16 px tall — the two recovery paths on the most important page on the site. | measured, deployed site | High |
| F5 | Documentation table-of-contents links are 20 px tall, on all 13 docs pages. | measured, deployed site | Medium |
| F6 | The `proofMetrics` strip presents "4", "1" and "Async" as headline proof figures. They prove nothing. | `marketing-content.ts` `proofMetrics` | Medium |
| F7 | 90 distinct button class strings for 115 buttons; 6 corner radii (`rounded-full/lg/xl/md/[16px]/[20px]`), 9 heights, 12 padding pairs. 286 distinct card/panel class strings for 437 panels. The brand defines one control radius (8px) and one panel radius (12px). | whole-tree scan | High |
| F8 | `GoogleIcon` is four disconnected stroke fragments and does not resemble Google's mark. Root cause: brand logos were forced through a stroke-only icon base (`fill="none" stroke="currentColor"`), which cannot draw a filled logo. On the sign-in page this costs trust exactly where trust is decided. | `src/components/ui/Icons.tsx:265-283` | Medium |
| F9 | Docs tag pills are `<span>` styled exactly like filter chips — rounded-full, bordered, tinted. They are not clickable. `/docs/search` exists but takes no query parameter, so the tags cannot currently link anywhere either. | `src/components/docs/DocsFrame.tsx:196-203` | Medium |
| F10 | Error copy addresses developers, not users: "No technical details were exposed" (reassures nobody and alarms some) and "check the status logs" (users have no status logs). The `error.digest` that would let a user report the problem is discarded. | `src/app/error.tsx:15`, `src/app/global-error.tsx:18` | Medium |
| F11 | 864 lines across six components that nothing imports — no static, dynamic or lazy reference anywhere: `AuthStatus`, `PlannedDashboardSection`, `PrimaryNavigation`, `StartWorkspaceClient`, `WorkspaceEmptyState`, `WorkspacePapersClient`. They are orphans of routes that were later turned into `redirect()` shims. They do not bloat the bundle (Next tree-shakes them); they mislead maintainers. | verified by exhaustive grep | Low |
| F12 | The four feature pages each carry a `gradient` from the Vercel template palette, and 3 of 4 fill a `metric` slot — rendered as a large display numeral — with prose like "Tools search + charts" and "Session file context". | `marketing-content.ts` | Medium |
| F13 | **Every dark-mode user sees the site load light, on every navigation.** `ThemeProvider` initialises to `"light"` and only corrects in a `useEffect`, after first paint; there is no pre-paint script in the root layout. Measured on the deployed site with the system set to dark: first painted frame at t=309 ms is `rgb(248,250,252)` with no `dark` class; the class lands at t=474 ms — **165 ms of light**. Worse, `body` carries `transition: background-color var(--motion-ui)`, so the correction is not a flash but a visible 220 ms animated wipe from white to black. | `src/components/theme/ThemeProvider.tsx:30-46`, `src/app/layout.tsx`, `globals.css` body transition | High |
| F14 | "Popular docs" flags 9 of 13 pages — 69%, so the label curates nothing — and the same pages are listed again, grouped, immediately below. The mobile docs index is 4,608 px of largely duplicated navigation. | `src/lib/docs-content.ts:968`, 9× `popular: true` | Medium |
| F15 | On a phone the workspace breadcrumb renders as "Rep… > T…". Both segments are `truncate` in a flex row sharing a 390 px header with six other controls, so neither survives. A user cannot tell which repository they are in. | `src/components/workspace/WorkspaceShell.tsx:134-158` | Medium |
| F16 | The library toolbar stacks nine controls (New, Trash, Search, Type, Modified, Source, Sort, Refresh, view toggle) above the list. On a phone that is roughly 500 px of chrome before the first repository. "Trash" is given the same visual weight as "New", and "New" carries a tinted fill that appears nowhere else in the brand. | `src/components/admin/AdminImportClient.tsx`, measured at 390 px | Medium |

### Checked and found NOT to be defects

Recorded so the same ground is not re-investigated.

- **Route sprawl.** `/chat`, `/workspace`, `/start`, `/organizations`, `/organizations/new`,
  `/organizations/[id]/projects`, `/workspaces/new`, `/workspaces/[id]/projects`,
  `/workspace/papers`, `/workspace/imports`, `/admin/import` are all `redirect()` shims for
  legacy URLs. Nothing in the UI links to them. The real surface is 8 authenticated pages
  plus login, landing, docs and features. This is clean, not sprawl.
- **`text-[#d4d4d4]` in `MarketingLayout`.** Predicted to be invisible in light mode; it is
  `dark:text-[#d4d4d4]` with a `text-slate-700` light counterpart. Not a defect.
- **Docs thinness.** All 13 pages run 258–687 words across 4–6 blocks. Substantive.
- **Landing-page blank bands.** Harness artifact, see above.
- **"9 analysis passes" on the paper-analysis feature page.** Suspected fabrication. The
  ingestion graph in `graphs.py:77-89` has **13** nodes — extract, clean, translate,
  segment, metadata, extract_author_keywords, mine_keywords, group_topics, label_trends,
  classify_tracks, classify_typology, extract_facets, build_dataset. The published number
  understates the real one. Not a defect. "20+ paper signals" is likewise defensible.
- **Four templated feature pages.** Suspected filler. Each page has bespoke copy, its own
  sections and bullets, and draws from eight distinct showcase components. Substantive.
- **Mock data leaking into production.** `isPreviewMode = data?.useMock ?? true` defaults to
  preview, which looked alarming. Every live server path sets `useMock: false` explicitly,
  and the state is labelled "Preview data" vs "Live data" in the UI. Not a defect.
- **`text-[#d4d4d4]` in `MarketingLayout`.** Already covered above — `dark:` scoped.
