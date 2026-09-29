# 30 — Adaptive tab: from chart picker to insight finder

Status: **in production** (2026-09-29).
- PRs #201–#207 were promoted in #208.
- Rollback: web `papertrend-web-production-00058-gl9`.

## The question this answers

The Adaptive tab worked, but it rarely told a reader anything the other tabs didn't. The brief:
- find out why, and make it smarter;
- have it find patterns in the selected papers that no fixed tab shows, and explain them in plain
  words;
- keep the cost suitable for a self-funded OpenRouter account.

## What it did before

A reader clicked **Generate charts**, and the flow was:
1. The server built an analytics payload for the filtered papers.
2. One model call chose 1–5 of **7 fixed chart types** and wrote a title and a reason for each.
3. The browser recomputed most charts from its own copy of the data.

A real run on the pilot, against `testtest` (41 papers), chose four charts:
- momentum;
- emerging topics;
- category × theme;
- a theme × year heatmap, titled "keyword frequencies".

**All four repeat a fixed tab**, and the reasons carried **no numbers and no findings**. The payload
was 58,307 characters (about 15k tokens), and nothing capped it. The plan cost about $0.007.

**Why it could not do better:**
1. **Templates only.** The model could not choose what to compare or what to measure.
2. **Every template repeated a fixed tab.** The prompt never said what the fixed tabs already show.
3. **Counts only.** Typology, aims, author keywords, method themes and duplicates never reached
   it, though Cloud SQL holds them.
4. **Nothing was checked.** The model planned from one copy of the data while the page drew
   another, and no rule made its text match either, so it wrote safe, generic text.
5. **No statistics.** It had no share of each year's papers, no co-occurrence and no robustness
   check. Small selections dropped support to a single paper.
6. **Bugs.** The snapshot dropped category assignments, so the repository's own categories never
   showed. The "emerging" chart cut off losing themes. The rubric code was never called. The
   Library page made a hidden planner call on every visit and discarded it. Planner tokens were
   not counted.

## What it does now: compute first, then let the model choose and explain

```
selected papers ─► insight library (code, free) ─► up to 10 ranked insights
                                                    each: question, chart data, facts, support
                         │
                         ├─► shown at once, with computed sentences (no model, no cost)
                         │
                         └─► "Write up with AI": one ~3.2k-token call
                              picks 3-5, orders them, writes titles and takeaways
                              ─► checker: every number must be a computed fact, no causal
                                 claim, no "significant", length caps; anything that fails
                                 goes back to the computed text
                              ─► cached for this selection + prompt version
```

The model is the **editor**; statistics in code are the **analyst**. The chart a reader sees is
drawn from the same insight object the model was shown, so the two cannot disagree.

### The insight library (`src/lib/insights/analyses.ts`)

None of these is on a fixed tab (`fixed-views.ts` lists the fixed charts, and a test checks
them).

| Insight | What it measures |
| --- | --- |
| Themes studied together | Lift (how many times chance), which must hold with one fewer shared paper. A theme wholly inside a related one is dropped as a part-and-whole. L1, L2, EFL and SLA are read as the words they stand for. |
| Methods by theme | A papers grid with strong pairings marked, plus "none where about 3 were expected" |
| Ways of doing research gaining or losing ground | Method themes' early vs late share, using the Trend tab's shift rules |
| How the balance between categories shifted | The same rules, applied to categories |
| What sets each category apart | Themes at least 1.5 times as common in a category as in the rest |
| New, enduring and faded themes | First and last appearance; "new" means every paper is in the most recent third |
| Broadening or narrowing | The expected number of themes among k papers from each half (rarefaction). It must survive removing any one paper, or no claim is made. |
| What studies set out to produce | Contribution types (facets), and their shifts |
| What kinds of study these are | Typology, merged by group number across the EIL and General labels |
| Papers that bridge themes | The only paper joining two themes, each with 4+ papers, that would be expected to meet more often |
| Author keywords no theme names | Keywords from 2+ papers that match none of those papers' themes or topics |

**Rules:**
- Every claim needs at least 3 papers.
- Associations must hold with one fewer shared paper, and shifts must survive removing any one
  paper.
- Duplicate uploads are counted once. Both the pipeline's content fingerprint and the title
  heuristic are used.
- Undated papers are left out of patterns over time only.

### The model's part (`plan.ts`, `check.ts`)

- **Input:** about 3.2k tokens.
  - the selection in words, and the repository's field and categories;
  - what the fixed tabs show;
  - up to 10 candidates, each with its question, facts (ID, value, meaning), a computed draft
    and any caution.
- **Output:** forced through the `write_insights_page` tool: a headline, a summary, 1–5 cards, and
  up to 2 caveats.
- **Checks:**
  - Every number in a title, takeaway, headline or caveat must equal a fact (±1 for a percent,
    10% for a ratio). Digits inside theme names and quoted titles don't count, and periods like
    "2011–2021" are read as their two years.
  - "Significant" is stripped. A causal claim ("leads to", "drives", "because of") sends the text
    back to the computed sentence.
  - Replacements are logged with a reason (`insights_spend` → `checks`) and never shown.
- **Model:** `google/gemini-3.1-flash-lite`, the `ADAPTIVE_INSIGHTS` task default.
  `MODEL_TASK_ADAPTIVE_INSIGHTS` switches it without a deploy; `openai/gpt-5.6-luna` is the
  planned alternative.

### Ask about these papers (`ask.ts`)

A question is turned by one small call into a query over a fixed menu:
- **What to count:** theme, method, category, contribution, kind of study, aim or year.
- **How:** a count, a cross of two dimensions, or a change early vs late.
- **Optionally narrowed** to values that exist in the selection.

Code runs the query. **The answer's title, numbers and sentence are all computed**, and the
model's own words never reach the page. Questions the data cannot answer (authors, citations) are
declined in a sentence.

### Cost and caching

| | Before | Now |
| --- | --- | --- |
| Opening the tab | an empty state and a button | computed insights, free |
| Input tokens per AI plan (testtest) | ≈ 15k, growing with themes | ≈ 3.2k, bounded |
| Cost per AI plan | ≈ $0.007 | **$0.0016** (measured) |
| Revisiting | a new call per click | free (cached per selection and prompt version) |
| Library page | a hidden call per visit | none |
| Tokens in the daily budget | no | yes (`persistAiTokenUsage`) |
| Quota | charged even without a model call | only when a model is called |

## How it was measured

Nearly all of it cost nothing.

- **Code tests** (`tests/adaptive-insights.test.ts`, 20 tests): a synthetic collection with
  planted patterns, where each must be found with its numbers. The file also tests:
  - the ≥3-paper rule, duplicates and categories-off;
  - that no insight repeats a fixed view;
  - the checker's accepts and rejects;
  - wrong, causal or over-long model text being replaced;
  - the ask engine;
  - that opening the tab never calls a model.
- **The invite SQL and other suites:** 775 tests pass in total.
- **Claude as judge.** The ideal page for each scenario was written down before any model ran,
  and plans were scored on a fixed rubric: new vs fixed tabs, insight, grounding, clarity,
  honesty. Each is 1–5.

**Real write-ups on the pilot** (Gemini 3.1 Flash-Lite, prompt v2): six scenarios (the whole
repository, 2022–2025, 2011–2021, one category, a search, and Test 2), with **0 corrections**, in
2.4–3.3 s.

| | Old planner | New |
| --- | --- | --- |
| Charts that repeat a fixed tab | 4 of 4 | 0 |
| Numbers in the text | none | every takeaway, all checked |
| Rubric (out of 25) | ≈ 7 | ≈ 22 |

- **The whole repository:** it led with mixed-methods designs rising from 0 of 17 papers
  (2011–2021) to 6 of 19 (2022–2025), then framework proposals (6% to 32%), then the Assessment
  category's fall (24% to 5%).
- **Caveats:** it named small selections and duplicates counted once.
- **Small repositories:** Test 2 (5 papers) got the computed page, "nothing strong enough yet",
  with no call.
- **Fixed after judging:**
  - "significant";
  - filler second sentences;
  - leading with a part-and-whole theme pair.

Gemini's quality met the bar, so GPT-5.6 Luna was not needed.

**Ask trial** (five questions, one of them unanswerable by design):
- **First round:** three answered well. Two ignored the subject they named ("…papers on
  assessment", "…in writing papers").
- **The fix:** flat focus and about fields, worked examples in the prompt, and narrowed answers
  compared with all papers.
- **Second round:** all five correct. For example: "Mixed-Methods Research Designs appears in 1
  of the 5 papers on writing (20%), against 17% of all 36 papers selected". The authors and
  citations question was declined.
- **Cost:** about 1.2k tokens per question.

**Through the page:**
- "Write up with AI" and a typed question both work.
- A reload shows "Saved 1 minute ago" with no model call.
- Both themes, at desktop and 390 px, have no page overflow and no console errors.
- The screenshots led to three fixes:
  - full wrapping labels instead of chart axes;
  - "vs" instead of "→" for contrasts;
  - no repeated question on computed cards.
- The cache is keyed by the papers selected, not by how the filters are spelled.

**Spend on this work (OpenRouter), about $0.024 in total:**
- **$0.0169** from the server logs, over 21 write-ups and questions, with 2 corrections and 0 failures;
- about $0.007 for the old planner's baseline call.

**Production:** web `papertrend-web-production-00059-pjq` and worker `00053-6sx`. Checked there:
- the write-up, a question and the saved-plan reload, through the page;
- every dashboard tab and the Library, with no console errors.

## Second round (2026-09-29, PRs #211–#212)

**Fixed:**
- **Filler after the numbers.** A closing sentence that opens with "This/These/It", uses a
  reporting verb, and names and counts nothing ("This shift highlights a changing focus…") is
  removed. So is a trailing ", indicating …" clause (`dropFiller`). The prompt allows a second
  sentence only when it adds something (prompt v4).
- **Sub-topic pairs.** A theme wholly inside another whose name shares any content word with it
  ("L2 Sentence and Online Processing" inside "Second Language Acquisition Theory", with L2 read as
  "second language") is no longer offered as a pairing.

**Acceptance criteria**, on the pilot, then production:

| # | Result |
| --- | --- |
| A1 | No insight repeats a fixed-tab view, in any of 6 scenarios |
| A2 | Every number in 3 fresh write-ups is a computed fact; 0 corrections |
| A3 | No claim below 3 papers; the 7-paper and 5-paper selections show a notice and no charts |
| A4 | Every card is an insight the page draws from the same object |
| A5 | Every write-up beats the old planner on the rubric |
| A6 | 1.7k–3.0k input tokens per write-up; revisits are served from the cache; the Library page makes no call |
| A7 | Tokens are persisted after each call, with no persistence failures logged |
| A8 | With no write-up (model off), the page shows 5 computed insights |
| A9 | 786 tests green, build clean; both themes at desktop and 390 px, with no overflow and no errors |

## Not done, on purpose

- **The Python `nodes/visualization.py`** is still used by the chat and deep-research graphs, so
  it stays.
- **The semantic-map neighbourhood insight** (clusters × year) waits until the map's clusters are
  labelled consistently.
- **Typology groups** are merged by number across the EIL and General schemes. A repository that
  never switched profile is unaffected.
