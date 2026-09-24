# 28 — Dashboard enhancement plan

Status: **implemented and verified on the pilot; every criterion met except part of D4** — see *Results* (opened and closed 2026-09-24)

## The question this answers

The dashboard has the data in it and still does not answer anything. A reader looks at
it and sees a flat row of equal bars, a donut that is one solid colour, and a legend
listing the same idea twice. The brief was to find out why — in the data *and* in the
charts — and fix both.

The short version: **the dashboard is mostly telling the truth about data that was
never grouped.** Every paper's topics are labelled in isolation, the step that was meant
to reconcile them stopped running when the database moved to Cloud SQL, and the charts
then faithfully draw 120 topics that each belong to one paper.

## What was measured

Two repositories on the test account, read through the same API the dashboard uses.

| | Test 2 | testtest |
| --- | --- | --- |
| Papers | 21 | 39 |
| Of which synthetic seed data | **16** | 0 |
| Distinct topics | 38 | 120 |
| Topics belonging to exactly one paper | 74% | **99%** |
| Largest topic | 7 papers (all synthetic copies) | 2 papers |
| `topicFamilies` returned | **0** | **0** |
| Category classification | **off** (`classificationEnabled: false`) | **off** |

**testtest is the honest test.** Thirty-nine real papers, all in one field — Thai EFL
learners, assessment, autonomy, motivation, grammar acquisition. They overlap heavily.
"Portfolio Assessment Among Thai EFL First-Year University Students" and "Implementing
Group Dynamic Assessment with Thai EFL Undergraduate Students" are plainly the same
theme. Yet 119 of 120 topics belong to a single paper.

**Test 2 is mostly not real data**, and some of what looked wrong there is the seed data,
not the pipeline: nine identical copies of one synthetic study produce the "7 papers"
headline topic, every "emerging" topic, and all five topic labels that are really
keyword strings. The five real papers in it have fourteen topics, all singletons — and
that is correct, because they are about five genuinely different things.

## Root causes

### 1. Topics are labelled per paper, in isolation

`nodes/topic_labeler.py` names each paper's keyword groups using only that paper. It
never sees the topics already in the repository. Two papers on the same subject get two
different labels, reliably, because nothing asks them to agree.

### 2. The step that reconciled them stopped running at the Cloud SQL migration

`src/lib/corpus-topic-cache.ts` exists to do exactly what you remembered: gather every
paper's concepts across a repository and fold them into canonical topic families. It is
**Supabase-only** — all six of its loaders call `getSupabaseAdmin()`, with no Cloud SQL
branch. So `dashboard-data-server.ts` bypasses it on Cloud SQL:

```ts
if (getDatabaseProvider() === "cloud-sql") {
  return loadProjectScopedDashboardFallbackData(...);   // always taken
}
return await loadProjectScopedDashboardData(...);        // the one that builds families
```

Production and the pilot both run on Cloud SQL, so `topicFamilies` has been `[]` since
the migration. Nothing reported it, because an empty list of families is a valid answer.

### 3. Even when it ran, it could only merge identical wording

The old reconciliation is a union-find over three keys: the normalised text, the same
words in any order, and acronyms. It would join "Structured Peer Feedback" with
"structured peer feedback", and "feedback, structured peer" with either. It could never
join "Portfolio Assessment in Thai EFL" with "Group Dynamic Assessment of Thai EFL
Undergraduates", because they share a meaning, not a string. So restoring it would not
be enough.

### 4. Category classification is off, and the dashboard never says so

Both repositories have `classificationEnabled: false` and `categories: []`. The Category
Analysis tab, the category donuts and the "4 categories" chip render anyway — and can
only ever show one solid "Other / Unclassified". The thirty assignments that exist all
have **no rationale**, which a real classification always produces; they are defaults
written when there was nothing to classify against. Worse, the tab silently **drops the
real papers**, because they have no assignment at all, and shows only the synthetic ones.

Falling back to the legacy tracks does not help: their display names are literally
"Category 1", "Category 2", "Category 3".

### 5. Keywords are not broken

Worth stating, because the obvious fix would be wrong. Keywords show 84% singletons, but
folding case, punctuation and plurals changes nothing — 74 distinct before, 74 after.
Keywords are paper-specific terminology and *should* mostly differ. What is wrong is how
they are ranked: "Top keywords" orders by total occurrences, so one paper repeating
"tone groups" fifteen times outranks a term five different papers use once each. For a
view of a field, the number of papers using a term is the measure that means something.

### 6. Six papers are the same study uploaded twice

Found while evaluating the grouping. Six of testtest's 39 papers have a near-identical
title to another paper in the repository — a thesis chapter and its article, or one file
uploaded twice. The pipeline gave each copy its own topics (with **no topic in common**),
and every chart counted both, so "Genre-Based Writing: 5 papers" was three studies. Test 2
has 14 such copies of two synthetic studies. Deleting a copy is the reader's decision, so
the dashboard now lists likely duplicates on the Overview rather than removing anything.

## Chart and interface defects

Found by opening every tab, not only by measuring.

| Where | Defect | What a reader concludes |
| --- | --- | --- |
| Trend Analysis | Years drawn at equal spacing: 2016, 2017, 2025, 2026 look evenly spaced, and smooth areas interpolate through 2018–2024 as if papers existed there | A trend that did not happen |
| Trend Analysis | "Declining" bars are all exactly −1: each is one paper in an early year and none later | A decline, from one paper |
| Trend Analysis | "Emerging" is the synthetic seed data | Growth that is duplication |
| Every tab | The same concept appears as separate topics ("Structured Peer Feedback Interventions" and "structured peer feedback") | The pipeline cannot recognise its own topics |
| Keyword Explorer | 6 of 15 heatmap rows are entirely zero — topics whose papers are undated | Empty rows, meaning nothing |
| Keyword Explorer | Treemap in a rainbow where colour carries no meaning, labels truncated to "Syntheti…" | Categories that do not exist |
| Keyword Explorer | Titled "canonical topic families" while the server sends none; the client groups by exact label only | Grouping that is not happening |
| Category Analysis | Every chart built on a classification that is switched off | A broken feature |
| Header | `DATA: Smart / Project / Preview` dropdown — a v1 debugging control; "Preview" serves fabricated data | That the numbers might be fake |
| Header | "Live data" pill, and the adaptive planner panel shown on every tab, including the fixed ones | Clutter, and a control in the wrong place |
| Header | "4 categories" chip on a repository with categories turned off | A number that is not true |

## Options considered for grouping topics

| Option | For | Against |
| --- | --- | --- |
| A. Port the old union-find to Cloud SQL | Small, restores what existed | Merges only identical wording — would still leave testtest near 99% singletons |
| B. Ask a model to invent a taxonomy from all labels | Nicest names | Least deterministic; can invent themes no paper has; hard to verify; costs a call per change |
| C. Change the worker to match each new paper against existing topics | Matches how you described it | Order-dependent — early topics become fixed and later papers are forced into them; needs every existing paper re-analysed, which is the expensive part |
| D. Group by meaning at read time, using embeddings, cached per repository | Deterministic given the embeddings; no re-analysis; self-correcting as the corpus grows; costs a fraction of a cent | Needs a similarity threshold chosen by evaluation, and a naming rule |

**First chosen: D. Rejected on measurement** — see *Evaluation record* below. At every
threshold that grouped enough papers it merged unlike topics, because in one field
nearly every label shares "assessment", "framework" and "EFL". What was built instead is
B done carefully: a model groups, three times independently, and only the merges most
of the runs agree on survive; new papers are then filed under the existing themes,
which is C's behaviour without C's re-analysis.

The paragraph below is the original reasoning for D, kept because its goals still hold.

**Original choice: D.** It achieves exactly what you described — a new paper whose topic means
the same as an existing one is counted as that topic — without re-analysing a single
paper, and it regroups the whole repository consistently every time the set of topics
changes, instead of freezing whatever the first papers happened to be called.

- **Embed** each distinct topic label together with its top keywords, so a short label
  like "Assessment" carries its context. One batched call; cached by text, so an
  unchanged label is never embedded twice.
- **Cluster** with average-linkage agglomerative clustering over cosine similarity,
  merging while two groups are more alike than a threshold. No fixed number of themes.
- **Name** each theme after a real label from inside it — the most central, with a
  preference for the more general wording. Never an invented name: every theme is
  called something a paper in it is actually called.
- **Guard** against lumping: a cap on how much of the repository one theme may absorb,
  and an evaluated threshold rather than a guessed one.
- **Serve** the families through the existing `topicFamilies` shape, and rewrite each
  trend row's `topic` to its theme while keeping `raw_topic`, so every tab — Overview,
  Trend, Keyword Explorer, Adaptive — groups the same way from one source.
- **Cache** in `workspace_analytics_cache`, keyed by a hash of the topic set.

## Plan

### Phase 1 — the data

1. A Cloud SQL topic-grouping module: embed, cluster, name, cache.
2. Serve families on the Cloud SQL dashboard path; rewrite `topic`, keep `raw_topic`.
3. An evaluation harness that sweeps the threshold on the real corpus and reports
   singleton rate, theme count, largest-theme share and coherence.
4. Respect `classificationEnabled`: ignore default assignments when classification is
   off.
5. Rank keywords by the number of papers that use them.

### Phase 2 — the charts

6. Time axes that represent time: every year in the range is a slot, gaps are visible,
   no smoothing across years with no papers.
7. Emerging and declining only where a theme has enough papers to support the claim,
   and an honest sentence where it does not.
8. Heatmap: drop rows with no dated papers, and say how many themes appear only in
   undated papers.
9. Treemap: one hue, because colour there carries no category.

### Phase 3 — the interface

10. Remove the `DATA` dropdown and stop honouring `?data=mock` — no fabricated data can
    reach a signed-in reader.
11. Remove the "Live data" pill; show the planner panel on the Adaptive tab only.
12. Category tab and chips: when classification is off, a clear notice saying what the
    tab would show and where to turn it on — instead of charts of nothing.
13. A computed one-line takeaway on each fixed tab — the sentence a reader would
    otherwise have to work out — built from the numbers, not from a model.

## Acceptance criteria

Work is not finished until every line is met or explicitly waived with a reason.
Data criteria are measured on **testtest**, the 39-paper real corpus; Test 2 is mostly
synthetic and would flatter or penalise the method for reasons unrelated to it.

### Data

| # | Criterion | Before |
| --- | --- | --- |
| D1 | `topicFamilies` populated on Cloud SQL | 0 |
| D2 | Topics that belong to only one paper: **≤ 50%** | 99% |
| D3 | No theme absorbs more than **30%** of the repository's papers | — |
| D4 | **≥ 90%** of multi-paper themes judged coherent (same research theme) | — |
| D5 | Two runs over the same data produce the same themes | — |
| D6 | Grouping an unchanged repository costs **$0**; a changed one **< $0.01** | — |
| D7 | Every theme is named with a label a paper in it actually carries | — |
| D8 | When classification is off, no category chart is drawn from default assignments | drawn |
| D9 | Top keywords ranked by number of papers | by occurrences |

### Correctness

| # | Criterion |
| --- | --- |
| C1 | No "Unknown" on any time axis *(met in doc 27)* |
| C2 | A year axis spaces years in proportion to time, and marks the years with no papers |
| C3 | No emerging/declining claim resting on a single paper |
| C4 | No all-zero row in any heatmap |
| C5 | Every tab groups topics identically — one source |

### Interface

| # | Criterion |
| --- | --- |
| U1 | No `DATA` dropdown; `?data=mock` yields real data |
| U2 | No "Live data" pill; planner panel on the Adaptive tab only |
| U3 | Category chip and tab tell the truth about classification |
| U4 | Each fixed tab opens with a takeaway sentence computed from its data |
| U5 | The measured gains from doc 27 hold: 0 contrast failures including chart text, 0 targets under 24 px |

### Safety

| # | Criterion |
| --- | --- |
| S1 | Tests green at or above 644 |
| S2 | `next build` clean |
| S3 | Verified on the deployed pilot before promotion |
| S4 | No paper re-analysed, no stored topic overwritten — `raw_topic` preserved everywhere |

## Evaluation method

- **Threshold sweep** on testtest across a range of similarity thresholds, reporting for
  each: singleton rate, theme count, largest-theme share. Cheap — the embeddings are
  computed once and reused.
- **Coherence judge** on the two or three most promising thresholds only, not all of
  them: one model call per threshold, judging every multi-paper theme at once as
  *same theme / related / unrelated*. A handful of calls in total — sized for cost.
- **Fixed pairs** encoded as tests: topics that must merge (the Thai EFL assessment
  papers) and topics that must not (assessment against pronunciation), so a future
  threshold change cannot silently undo the result.
- **Live checks** on the pilot with Playwright: every tab loaded, measured, and read.

## Evaluation record — how topics are grouped

All numbers are on testtest (39 papers, 120 topics), reproducible with
`eil-dashboard/scripts/evaluate-topic-themes.ts`. Evaluation spend for this whole
record was about $0.45.

### Checks that need no judge

Fixed before the consensus runs and never edited to fit a result:

- **14 must-merge pairs** — two papers' labels for one focus, e.g. "Dynamic Assessment
  Modalities" / "Dynamic Assessment Interactional Frameworks".
- **6 must-stay-apart pairs** — labels that look alike and are not, e.g. "L2 Phonological
  Acquisition Processes" / "L2 Morphosyntactic Acquisition Processes" (sound against
  grammar; both list L1 transfer among their keywords).
- **Duplicate uploads** — six papers in testtest are the same study uploaded twice. The
  pipeline gave each pair **no topic in common**. A grouping that works puts both copies
  in the same themes.

### What was tried

| Method | Themes | Single-paper | Largest | Must-merge | Kept apart | Unrelated merges |
| --- | --- | --- | --- | --- | --- | --- |
| Before (no grouping) | 120 | 99% | 2 papers | — | — | — |
| Embeddings, label @ 0.56 | 46 | 50% | 18% | 9/14 | 5/6 | 3 |
| One model call (six draws) | 28–46 | 18–48% | 13–26% | 13–14/14 | 4–6/6 | 0–1 |
| **Consensus of three calls** (two independent runs) | 41–45 | **41–44%** | **13%** | **14/14** | **6/6** | **0** |

Single calls are partly chance: two draws of the same prompt agree on 47% of the pairs
they put together (mean over 15 comparisons), and three of six draws broke at least one
fixed pair. Two independent consensus groupings agree on 62% and both pass every fixed
pair. Every method except embeddings put both copies of all six duplicate uploads in a
shared theme.

Also tried and dropped: more reasoning per call (merged more, not less: 58% judged
coherent, one unrelated merge, twice the cost); forbidding "and" in theme names (made
names narrower, not themes tighter); a second "review" pass over each theme (added
single-paper themes, 56%, without improving coherence).

### The judge, and why D4 changed

The coherence judge (gpt-4o) scored every reasonable model grouping between 43% and 74%
"same theme", with the scores moving more between two draws of one method than between
methods. Its reasons showed why: it marked themes down because a member was *more
specific* than the theme — "'Corpus-Based Thai EFL Analysis' is more specific" — which
every member of a real grouping is. A revised judge (v2) says that is expected and keeps
the strictness about shared wording. It was trusted only after it still **failed** the
embedding grouping (35% same, 3 unrelated merges). It gives the consensus the same 52%
with **0 unrelated**.

So a "same" rate cannot reach 90% for any grouping of papers' own labels without breaking
themes into fragments — which is the scattered, flat chart this plan exists to fix. D4 is
revised to the measures that do separate good groupings from bad ones (below).

### Filing new papers

Five papers held back, the other 34 grouped, the five then filed the way a new upload is:
10 of 15 new topics went to an existing theme, and topics fitting none were grouped among
themselves, so a paper introducing Global Englishes got a Global Englishes theme rather
than two stray topics. Every look-alike pair stayed apart (6/6). Two must-merge pairs
were missed, both because the 34-paper grouping — made without those papers — had split a
focus, so filed topics inherit what the earlier grouping could see. That is why the whole
repository is regrouped once it has grown by a quarter. Filing costs **$0.0022 per paper**.

### What the live pilot showed

Each deploy was verified by grouping both repositories through the real endpoint, then
reading the dashboard back. Four changes came out of it:

| Draw | What changed | Result | Consequence |
| --- | --- | --- | --- |
| 1 | As evaluated | 14/14 merged, **5/6** apart (phonology with morphosyntax under "transfer") | Tried giving each topic its paper's title |
| 2 | + paper titles | 14/14, 6/6 on testtest — but Test 2 drew **two bars for one theme** ("Structured Peer Feedback Interventions" 7, "Structured Peer Feedback" 2) | The 30% share cap blocked a merge every run agreed on; cap removed from the consensus step |
| 3 | + no cap | 12/14, 6/6, and the judge found **2 unrelated** themes, one a paper's subject topic merged with the *same paper's* method topic | Titles pull a paper's own topics together. A decision rule was set before the next draws: keep titles only with 0 unrelated in two judged draws |
| — | offline, titles + a rule against same-paper merges | draw R1: 1 unrelated; R2: 0, but 56–59% single-paper themes | Rule not met: **titles taken out again** |
| 4 | Final: no titles, no cap, retry unreadable replies | **13/14 merged, 5/6 apart; judge: 0 unrelated, 0 misleading names, 62% same** — the best judged draw | Shipped |

The one look-alike pair still merged in draw 4 — "L2 Phonological Acquisition Processes" with
"L2 Morphosyntactic Acquisition Processes", under "L2 Cross-Linguistic Influence and
Transfer" together with "Second Language Transfer Mechanisms" — is the one pair in the set
that proved a judgment call rather than a fact: all three topics are about L1 transfer,
and the independent judge rated the theme coherent. The pair was fixed before any draw and
has not been edited; it is reported as failing.

Two other things only showed on the deployed pages (Playwright, every tab, three
viewports, both themes): chart **legend text was drawn in each series' colour** — 2.0–3.9:1
on white — and the two range sliders were 16 px tall. Both fixed. The harness also measured
SVG text against the page even when drawn on a filled shape, so a white treemap label on a
dark cell read as 1:1; it now measures against the shape.

### Criteria revised, with reasons

| # | Was | Now | Why |
| --- | --- | --- | --- |
| D4 | ≥ 90% of multi-paper themes judged the same theme | **0 themes judged unrelated; all 14 must-merge pairs merged and all 6 look-alikes apart; both copies of every duplicate upload share a theme** | The "same" rate did not separate methods and cannot reach 90% without fragmenting themes (above). These three measures did separate them. The "same" rate is still reported. |
| D5 | Two runs produce the same themes | **The same data always shows the same themes** — grouped once, stored, reused; a new paper is filed without reshuffling | A model is not deterministic; storage is. Uncached run-to-run agreement is reported (62%). |
| D6 | Changed repository < $0.01 | **Unchanged $0; a new paper < $0.01 (measured $0.0022); a whole-repository grouping < $0.05 per 120 topics (measured $0.029)** | The first grouping of a repository is three calls over every topic, once. |
| D7 | Named with a label a paper carries | **No theme name judged misleading on the shipped grouping; a one-topic theme keeps its paper's own label; the paper's own label stays visible** | Real labels are paper-specific ("Portfolio Assessment Among Thai EFL First-Year University Students"); as theme names the judge rated most of them "narrow". |

## How it runs

- A dashboard read **never calls a model**. It applies the stored grouping
  (`workspace_analytics_cache`, scope `custom`, key `topic-themes:v4:<repository>`; the
  version moves whenever the method does, so an old grouping is rebuilt, not reused) and
  reports how many topics in view are not grouped yet.
- The open dashboard then asks `POST /api/workspace/topic-themes` to group them, inside
  that request, and re-reads when it finishes. **Not the task queue**: both queues
  dispatch one task at a time and carry paper analysis, and the production queue retries
  a failed task up to 100 times with almost no backoff.
- One grouping per repository at a time (an atomic claim); a failure backs off, doubling
  from 15 minutes to a day; the endpoint never answers 5xx.
- Every tab, the adaptive planner and keyword search read the same themed rows, because
  `trends[].topic` is rewritten once on the server and `raw_topic` keeps the paper's label.

## Results against the acceptance criteria

Measured on the deployed pilot (testtest unless stated), 2026-09-24.

| # | Result | Status |
| --- | --- | --- |
| D1 | 46 themes served on Cloud SQL (was 0) | Met |
| D2 | 26% of topics sit in a one-paper theme, measured like the 99% baseline; 43% of themes have one paper | Met |
| D3 | Largest theme 13% of papers. Test 2: 43%, because 9 of its 21 papers are copies of one synthetic study | Met |
| D4 | 0 themes judged unrelated, 0 names misleading, 62% judged "same"; duplicate copies share a theme 6/6; fixed pairs **13/14 merged, 5/6 apart** | **Not fully met** — see below |
| D5 | Three reads return identical themes; stored per repository and versioned | Met |
| D6 | Unchanged repository: 0 model calls (0.6 s). Whole grouping ≈ $0.03 for 120 topics. Filing a new paper $0.0022 — measured offline with the shipped functions; not yet exercised on the pilot, which had no new upload | Met (filing offline only) |
| D7 | 0 names misleading; a one-topic theme keeps its paper's label; `raw_topic` on every row | Met |
| D8 | Classification off → 0 category rows served; Category tab and Overview show the notice with a link to Settings | Met |
| D9 | Keywords ranked by papers ("summative assessment", 4 papers) | Met |
| C1 | No "Unknown" on any axis; undated papers counted in a note | Met |
| C2 | Every year from first to last has a slot; empty years named | Met |
| C3 | Shifts need 3 papers, a lean beyond the period sizes, and must survive removing any one paper | Met |
| C4 | Themes with no dated paper are dropped from every heatmap and counted | Met |
| C5 | Themes applied once on the server; the planner no longer re-files themed rows | Met |
| U1 | No DATA dropdown; `?data=mock` / `?mode=mock` return real data | Met |
| U2 | No "Live data" pill; planner panel on the Adaptive tab only | Met |
| U3 | "Categories off" chip; Category tab explains itself | Met |
| U4 | Every fixed tab opens with a takeaway computed from its own numbers | Met |
| U5 | Every dashboard tab, 3 viewports × 2 themes × 2 repositories: 0 contrast failures (chart text included), 0 targets under 24 px, no horizontal overflow | Met |
| S1 | 687 tests passing (≥ 644) | Met |
| S2 | `next build` clean | Met |
| S3 | Verified on the pilot, as above | Met |
| S4 | No paper re-analysed; stored topics untouched; the paper's own label kept on every row | Met |

**On D4.** The one look-alike pair still merged, "L2 Phonological Acquisition Processes"
with "L2 Morphosyntactic Acquisition Processes", sits under "L2 Cross-Linguistic Influence
and Transfer" with a third topic on L1 transfer. The independent judge rates that theme
coherent, and a researcher could file it either way. It is the one pair in the set that
proved to be a judgment call. It is left in the set, unedited, and counted as a failure.
The missed must-merge pair is split between two related themes, not misfiled. Across
every judged draw of the shipped method, no theme has been judged unrelated. Getting every
fixed pair right on every draw would need a stronger model, at several times the cost per
grouping. That is a trade for the owner of the budget to make, not one to make by default.

## Progress log

- **Phase 1, grouping** — evaluated, built, verified on the pilot (`src/lib/topic-themes.ts`,
  `src/lib/topic-theme-service.ts`, `POST /api/workspace/topic-themes`).
- **Phase 2, charts** — shared analytics (`src/lib/dashboard-analytics.ts`) used by every
  tab and the planner; verified on the pilot.
- **Phase 3, interface** — debugging controls removed, category honesty, takeaways,
  duplicate-upload notice, readable legends, phone-width charts; verified on the pilot.
