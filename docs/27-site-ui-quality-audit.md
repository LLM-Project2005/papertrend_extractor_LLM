# 27 — Site-wide UI quality audit and remediation

Status: **complete and verified on the deployed pilot** (2026-09-24)

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
| Surfaces | `.app-surface`, `.app-card`, `.tab-btn` |

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

### Five harness bugs worth recording

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

**4. A wrapping `<label>` makes the control's own box the wrong thing to measure.**
A label that wraps its input forwards clicks to it, so the target a person aims at is the
label's box. Three inputs and selects sitting inside padded, bordered labels were reported
as 20 px targets when the thing you click is 37 px tall. Fix: measure the label for a
wrapped input, select or textarea. Without this the remaining count looked like real
defects, and chasing them would have added padding to controls that already had it.

**5. The sweep could not see the text it was most needed for.** Every chart label on the
site is SVG text, painted with `fill`. The checker read the `color` property, so it
reported a clean page while the axis labels sat at 3.5:1. That is not a small blind spot:
it is why four chart components were fixed off the back of a separate one-off script, and
why a fifth stayed broken long enough to be caught by eye instead. It measures SVG text
now, against the background of whatever HTML element encloses the chart, since an `<svg>`
paints none of its own.

While fixing that, a sixth: the in-page code lives in a template literal, and a comment
explaining it contained backticks around a property name. That ended the literal early.
The file stopped parsing — and the probe still ran, because the truncated string was
coincidentally valid JavaScript. A test now asserts no backtick or template hole appears
inside that block.

The pattern across all of them: the instrument reported a clean, plausible number while
measuring the wrong thing. Two reported problems the site did not have; three hid problems
it did. Any finding below was re-checked before it was acted on, and the two corrections
that removed false positives matter as much as the three that found real ones — a checker
mixing real and imaginary findings costs the same to chase either way.

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
the live hostname goes, the invented percentages go, and the stage names
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
| F1 | The landing page presents an entirely fabricated product mock — fake window chrome `analysis.run/webquest.pdf`, six bars representing nothing, invented percentages (96/88/74/91%), and the live hostname `research-trend-analysis.web.app` printed beside a teal connected-dot. None of it corresponds to a real Papertrend screen. (Correction: that hostname is **not** fake - it is the real Firebase site, with `papertrend.web.app` as its short alias. The defect is a static drawing presenting a real address as a live session, not an invented address.) | `src/components/marketing/FeatureShowcases.tsx:56-125`, `MarketingMotion.tsx:36-90` | High |
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

## Measured result

`scripts/capture-ui.ts` over 90 comparable page / viewport / theme combinations,
before against the deployed site and after against a local production build:

Verified on the **deployed pilot**, across 129 page / viewport / theme
combinations — including 39 authenticated pages, which could not be measured at
all until the work was deployed, because a local build has no session.

| Measure | Before | After |
| --- | --- | --- |
| Contrast failures (occurrences) | 75 | **0** |
| Contrast failures (distinct colour/size pairs) | 15 | **0** |
| Interactive targets under 24 px (occurrences) | 100 | **0** |
| Interactive targets under 24 px (distinct) | 61 | **0** |
| Pages with horizontal overflow at 390 px | 0 | 0 |
| Console errors | 3 | 3 — all three are the deliberate probe of a nonexistent URL |

Re-run once more after the harness was taught to read SVG text, so the closing number
includes every chart label on the site:

| | Final gate, live pilot |
| --- | --- |
| Pages captured | 129, of which 39 authenticated |
| Contrast failures | **0** — including **0** in chart text |
| Interactive targets under 24 px | **0** |
| Horizontal overflow at 390 px | **0** |
| Pages without exactly one `h1` | **0** |
| Images without `alt` | 0 of 0 — the site uses inline SVG, not `<img>` |
| Console errors | 3, all the deliberate probe of a nonexistent URL |

The authenticated half was worth the wait: it held the last small targets, the
two components that had escaped every dark-mode pass, and — only visible by
*looking* rather than measuring — a year span reading "2016 to Unknown" on the
first screen after signing in, and a raw transport exception as the most
prominent line under "Analysis failed".

Theme flash, measured with the system set to dark, sampling every animation
frame from navigation:

| | Before | After |
| --- | --- | --- |
| First painted frame | `rgb(248,250,252)`, no `dark` class | `rgb(0,0,0)`, `dark` already applied |
| Light shown for | 165 ms, then a 220 ms animated wipe | 0 ms |
| Distinct `body` background values during load | 14 | 1 |

### What only showed up by looking

Three defects survived every measurement and were found by opening the page and reading it.
They are recorded because they mark the limit of the method above.

- **"COVERAGE — 2016 to Unknown"** on the first screen after signing in, and an **"Unknown"
  bar to the right of 2026** on the default dashboard chart. This is the same bug fixed in
  the planner months ago and again in the adaptive tab: `"Unknown"` sorts after `"2026"` as
  a string. It turned out to have **eight** independent implementations of "which years are
  real". A test now pins every surface that puts a year on an axis, and pins the two where
  "Unknown" must *stay* — a paper's own year is a true fact about that paper, and filtering
  for undated papers is a useful thing to do.
- **A raw transport exception** as the most prominent line under "Analysis failed":
  `HTTPSConnectionPool(host='storage.googleapis.com', port=443): Max retries exceeded`.
  Most worker failures already read as sentences and are shown unchanged; only messages
  carrying library and stack signatures are translated, and the original still appears
  below, because that is where someone works out what happened.

No contrast checker or tap-target sweep would ever have flagged any of these. They are all
perfectly legible, correctly sized, and wrong.

### Two regressions this round introduced, caught by re-measuring

Recorded because the point of measuring after is that it finds your own mistakes.

- Recolouring a framer-motion `color` animation from the stock teal to `#f2f2f2`
  made the label **invisible in light mode** — 1.35:1 — because a JS animation
  writes an inline style the light-mode override layer can never reach. It
  animates opacity now, which reads the same in both themes.
- A `first:bg-[#0a0a0a] first:text-white` chip kept its near-black fill in light
  mode while its text took the converted slate-600, at 2.61:1. Same family as the
  hover bug: the override matches `.bg-[#0a0a0a]`, and `first:bg-[#0a0a0a]` is a
  different class name. Written with explicit light and dark variants instead.

## Status against the acceptance criteria

| # | Criterion | Status |
| --- | --- | --- |
| A1 | No text below WCAG AA | **Met** on every public page, measured across 90 page/viewport/theme combinations: 75 → 0 |
| A2 | No interactive target under 24 px | **Met**, measured. 100 → 0 |
| A3 | No horizontal overflow at 390 px | **Met** — was already clean |
| A4 | No console error | **Met** — only the deliberate 404 probe |
| A5 | Every unprefixed colour utility has a light-mode translation or is a deliberate accent | **Met** for what renders. The `first:`/`hover:` variant gap is closed on every affected control |
| A6 | Images have `alt`; icon-only controls have a name | **Met** for the controls the sweep found. Recharts `<g>` elements carry a tabindex and no name; they are chart internals, not controls |
| A7 | One `h1` per page | **Met** — the dashboard had none and now names itself |
| B1 | No fabricated statistic | **Met** — invented percentages replaced with real pipeline stages; "Coverage 91%" now matches the year span the product renders; every published figure is counted from the code by a test |
| B2 | No implementation detail in user-facing copy | **Met** — the build-note pillar, "No technical details were exposed", "check the status logs" |
| B3 | Illustrations are unmistakably illustrations | **Met** — "EXAMPLE WORKSPACE / illustration", fake hostname and liveness signals removed |
| B4 | Consistent naming | **Met** for the collision found — the command palette no longer gives two destinations the same name |
| C1 | Nothing shipped that renders nothing | **Met** — 864 lines of orphaned components, and `.app-muted` |
| C2 | Decoration earns its place | **Met** — the scanline is gone; the marketing grid is kept deliberately (see below) |
| C3 | No control that looks interactive and is not | **Met** — docs tag pills now search; the footer no longer dresses links as form controls |
| C4 | Perpetual animation removed or bounded | **Partly met** — the scanline is gone; `marketing-grid` still drifts (see below) |
| D1 | Near-identical greys consolidated | **Partly met** — `#666666`, `#6f6f6f`, `#888888` and 98 `text-slate-400` folded in. The full inventory is larger |
| D2 | Stock template palette removed | **Met** — zero occurrences remain anywhere in `src/` |
| D3 | One theming strategy per surface | **Not met** — see below |
| D4 | Controls of one role share an implementation | **Not met** — see below |
| E1 | Tests green at or above baseline | **Met** — 561 → 643 |
| E2 | `next build` succeeds | **Met** |
| E3 | Verified on a deployed site | **Met** — measured on the pilot after deployment, authenticated pages included |
| E4 | No weakening of authorization | **Met** — the security pass strengthened it; nothing in the handoff's "never" list was touched |

### Deliberately not done, and why

- **C4, the marketing grid.** It drifts 48 px over 18 s behind a mask that fades
  it out, and it is covered by the reduced-motion rule. Removing it would cost
  the hero its only texture to satisfy a criterion it does not really offend.
  The scanline was different: it swept the full height of every product frame
  every 4.8 s in colours that belong to no one.
- **D3, the two theming strategies.** The evidence decided this, as Decision 2
  said it would. 330 unprefixed declarations rely on the override layer, and the
  measured result is that the layer *works* for base colours — the light pages
  come back clean. It fails only for variant classes (`hover:`, `first:`), and
  every affected control has been rewritten with explicit variants. Rewriting
  330 working declarations would be churn with real regression risk. What is
  left is a documented trap: **a new `hover:`/`first:`/`focus:` colour utility
  written without a `dark:` prefix on a marketing surface will silently do
  nothing in light mode.** A test now fails if one appears.
- **D4, control primitives.** 90 distinct button class strings for 115 buttons,
  6 corner radii, 9 heights. Decision 3 chose to normalise values rather than
  migrate 552 call sites, and that work is not done — it is a large mechanical
  change that deserves its own round with its own verification, not a tail-end
  addition to this one.
- **Two repository pickers.** `/workspaces` and `/workspace/library` both list
  the same repositories, and clicking a card in the library silently changes the
  app's global project — so opening a repository "just to look" redirects the
  Dashboard and Chat you visit next. It is a genuine trap, but whether the
  library's picker should be scoped-local or should warn is a product decision
  about what "opening a repository" means, and not a reviewer's to make.
- **The settings preferences are write-only.** `goal`, `primarySource` and
  `desiredOutputs` are persisted and rehydrated and never read to change
  behaviour. Wiring them up is a feature; removing them discards intent. The
  planned connectors *are* labelled `PLANNED` in the UI, so the earlier report
  that they deceive the reader does not hold.

## Security review

Scope: 46 API routes, the authorization helpers, the SQL layer, CORS, uploads,
rate limiting, redirect handling, and what reaches the browser bundle.

**The codebase was in good order.** That is a finding, not a courtesy. Specifically,
and each checked rather than assumed:

| Property | How it holds |
| --- | --- |
| Tenant isolation | Every parameterized route calls `repository.method(user.id, resourceId)`. The owner comes from the verified token; no route reads an owner id from the body or query. A resource belonging to someone else returns 404, not 403, so existence is not leaked. |
| SQL | All 58 `client.query` calls are parameterized. The few interpolated fragments are assembled from string literals in the source, with values in the parameter array, and every statement is scoped by `owner_user_id`. |
| Internal callbacks | `x-worker-secret` via `isRepositoryJobSecretValid`: fails closed when unset, length-checks before `timingSafeEqual` (which throws on mismatched lengths). |
| Admin | A timing-safe secret, or a `role = 'admin'` lookup **in the database** — not a claim from the client. Fails closed on error. The destructive debug queue-clearer additionally returns 410 in Cloud SQL mode, which is production. |
| CORS | Allowlist only, no wildcard, `Vary: Origin` set, credentials deliberately not allowed because the endpoint is bearer-authenticated. |
| Uploads | Extension, size bounds, SHA-256 format, MIME allowlist, **and a `%PDF-` magic-byte check on the buffer**. Stored names are stripped to `[a-zA-Z0-9._-]`. |
| Redirects | `validateSafeReturnTo` rejects protocol-relative `//` targets and any absolute URL whose origin is not the configured site. |
| Secrets | No server-only module is imported by a `"use client"` file; no non-`NEXT_PUBLIC_` env var is referenced from one. The service-role key appears in two server-only modules. |
| XSS | No `innerHTML`, `document.write`, `eval` or `new Function` anywhere. The only `dangerouslySetInnerHTML` is the static pre-paint theme constant added by this round. |
| Rate limiting | Login attempts and daily AI budgets, with subjects stored as SHA-256 hashes rather than raw emails and IPs. |

### Changed

| # | Finding | Severity |
| --- | --- | --- |
| S1 | The admin secret was accepted from `?admin_secret=` as well as the `x-admin-secret` header. A query string is written to Cloud Run request logs, kept in browser history, and forwarded in the `Referer` header to anything the page links to. **No caller in the codebase ever sent it that way** — every one uses the header — so this was an exposure route with no consumer. Removed from both admin helpers. | Medium |
| S2 | The two cron routes compared their secret with `authHeader !== \`Bearer ${secret}\``, which short-circuits on the first differing byte, while every other secret in the codebase is compared in constant time. A remote timing attack against a high-entropy secret over a network is impractical, so this is hardening rather than a repair — but one exception is how the next one gets written. Now uses a shared `isValidBearerSecret`. | Low |

### Reported, not changed

Each of these is a trade-off that belongs to the owner rather than to a reviewer.
Changing any of them unilaterally would trade one risk for another.

| # | Finding | Why it is your call |
| --- | --- | --- |
| S3 | **The login rate limiter fails open.** In `assertLoginRateLimit`, any non-`GuardError` exception is caught, logged as a warning, and the request is *allowed*. If the database is unavailable or `security_rate_limit_events` is missing, brute-force protection silently disappears. | Failing closed would lock every user out during a database blip. Firebase Auth also rate-limits password attempts server-side, so there is a second layer. The question is whether you want availability or the guarantee here. |
| S4 | **`getClientIp` trusts the leftmost `X-Forwarded-For`.** Google's front end *appends* to a client-supplied `X-Forwarded-For`, so `split(",")[0]` can be a value the caller chose. The login limiter keys on `hash(email + hash(ip))`, so an attacker rotating that header gets a fresh bucket for each attempt against one account. | The correct index depends on your exact proxy chain (direct Cloud Run vs Firebase Hosting vs a load balancer), and guessing wrong silently breaks rate limiting instead of merely weakening it. Worth confirming the chain, then taking a fixed offset from the right. A second limiter keyed on the email alone would close it regardless of topology, at the cost of making account-lockout DoS possible. |
| S5 | **The admin secret is kept in `localStorage`** (`eil_admin_secret`). Any XSS on the site could read it, and it grants cross-tenant destructive operations such as the queue clearer. | It is an optional escape hatch — the `role = 'admin'` path already covers normal use — so it may simply be removable. That depends on whether you use it outside the UI. |
| S6 | `/api/admin/import/finalize` does not validate the object that was actually uploaded. The signed URL binds a content type and expires in 30 minutes, and the worker's PDF reader fails cleanly on a non-PDF, so the practical impact is a failed run by an authenticated user inside their own scope. | Low value, non-zero cost: adding a magic-byte read at finalize means fetching the object back. |

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
