# Charts that read right for 1 paper or 5,000 (2026-10-20)

Feedback from the user and the professor:

- On a repository of 6 papers, the Adaptive tab's charts look broken. Every bar is the same length when each value is 1.
- Lines like "25% here · 17% of all papers" are not explained by anything the chart draws.
- Chart mode's later charts in a conversation are just as confusing: bars run the full width, with "40%" and "20%" beside them.
- The first chart in that conversation ("Words per paper", in colour, with an axis) was clear.
- The professor suggested showing the numbers in absolute or relative terms.
- Papertrend has to beat free AI tools and NotebookLM for a researcher, or it has no reason to exist.

## 1. What was wrong

| Symptom | Cause in the code |
| --- | --- |
| Bars all one length when each value is 1 | `InsightChart` sizes every bar against the largest one (`value / max`). The largest bar always fills the width, so 1, 1, 1 fills it three times. |
| "2 papers" fills the whole width | The same rule. There is no axis, so nothing tells the reader that the full width means 2. |
| "25% here · 17% of all papers" | `runAskQuery` writes, under each bar of a narrowed question, the bar's share among the narrowed papers and its share among all of them. The bar draws neither number; it draws the count. |
| "40% of papers" under bars | The share of the papers in scope, in grey under each bar. The chart never says which papers, how many, or why a share is shown. |
| Two looks in one conversation | Chart mode draws reading charts (word counts, participants) with Recharts in `ChatChartCard`, and dashboard views with `InsightChart`. They have different axes, colours and labels. |
| A 6-paper repository has almost nothing on the Adaptive tab | Most analyses need 8 or more papers, so the tab is a notice plus whatever "Generate views" finds, often a chart of 1s. |
| A view where every value is equal is still drawn as a chart | Nothing checks whether a view varies. |

## 2. The rules every chart now follows

One chart system, `src/components/charts/`, draws the Adaptive tab, chat answers and Chart mode. It covers bars, grouped bars, stacked bars, year columns, lines, grids, tables, stat tiles and small pies. Its pure helpers live in `src/lib/charts/`.

1. **The chart says what one unit is.** A subtitle names what each bar or cell counts and how many papers are in scope. For example: "Papers with each theme · 6 papers · a paper can have several". Every number shown either sits on an axis or labels a mark.
2. **Bars start at zero on a visible axis with nice ticks.** The largest bar is never the scale. The axis runs to a rounded ceiling, so 37 is drawn on 0 to 40.
3. **Small counts are drawn as papers.** When every count is 15 or fewer, a bar is a row of squares, one per paper. One paper is one square, the same size in every chart. Hovering a square names its paper, and clicking opens it. A count of 1 can never stretch across the page.
4. **Absolute or relative, the reader's choice.** A chart of paper counts has a **Papers | %** switch. The percent view says what it is a share of, for example "% of the 41 papers". Where groups differ in size (earlier against later papers, a research area against the rest), percent is the default and every label still carries its count ("29%, 5 of 17").
5. **No view without variation.** When every value is the same, the answer is a sentence and a table, not equal bars. For example: "Each of the 7 themes appears in one paper; none stands out." A single row is a stat tile, not a one-bar chart.
6. **Colour carries meaning.**
   - A chart of one quantity is one colour.
   - When the bars are papers (word counts, participants), each bar takes its paper's research area, with a legend. The colours stay, and now they mean something. The colour rules come from the dataviz guide: one series is one colour, colour follows the entity, and there are at most 8 hues.
   - Earlier against later is two shades of one hue.
   - The value a question asks about is drawn in the accent colour and the rest in grey.
7. **Long and many.**
   - Labels wrap to two lines and show in full on hover.
   - Ten rows show at first, then "Show all N". Past 50 rows, the CSV has the rest.
   - Years with no papers stay on the axis as gaps.
8. **Everything is reachable without a mouse.** Every mark is a button with a spoken label, and each chart has a table view and a CSV.

## 3. A view for every size of collection

| Papers in scope | Adaptive tab leads with | Chart mode |
| --- | --- | --- |
| 0 | What to do next | The same |
| 1 | The paper's profile: year, research area, kind of study, methods, themes, contribution | Reading charts: its sections, its length, the figures in its tables |
| 2-7 | **The papers side by side**: a computed table, one row per paper. Then what they share (themes and methods in more than one paper), drawn as squares | Views drawn as squares, plus reading charts |
| 8-50 | The insights (docs/30), drawn with the new charts | Every view |
| 50-5,000 | The same, with the top 10 rows and "Show all", gridded years and the CSV | The same |

Compared with NotebookLM: its data tables (December 2025) and infographics (March 2026) are static outputs of a model. Here every number is computed from the papers, every mark opens its papers, every reading value carries its sentence, and the reader can switch between counts and shares.

## 4. Narrowed questions

"Which methods do the writing papers use?" now draws one of two things:

- **8 or more narrowed papers:** grouped bars, "Papers on writing (12)" against "All 41 papers", in percent with counts on the labels. This is the comparison the old grey line tried to make.
- **Fewer than 8:** counts only, drawn as squares.

## 5. Tests and evaluation

- `tests/support/chart-corpora.ts`: deterministic synthetic collections.
  - Sizes: 0, 1, 2, 3, 5, 6, 7, 8, 12, 20, 36, 60, 150, 500, 1,500 and 5,000 papers.
  - Shapes: skewed, flat, one theme, every theme unique, one year, gapped years, undated papers, duplicate uploads, Thai and very long names, and classification off.
- `tests/charts-*.test.ts`: every view the engine can build (each analysis and each suggested query) is run against every collection and checked for these invariants:
  - A count equals its papers.
  - A percent is its count over the stated whole.
  - The axis covers the largest value from zero.
  - Labels are unique and non-empty.
  - No view without variation is drawn as bars.
  - Every number in a takeaway is drawn or stated.
  - The same input builds the same view.
  - 5,000 papers build in time.
- Render tests: bar lengths follow the axis, squares count papers, the percent switch, no stray percentages, labels and table views.
- `scripts/chart-gallery`: renders every chart form against the collections in light and dark, at phone and desktop width. Playwright checks each one for overflow and overlapping text, and a contact sheet is read by eye.
- The Chart mode question bank grows from 22 requests to over 100, across forms, sizes, languages and follow-ups. Each request names the view it should get. The planner runs alone (`PLAN_ONLY`) on synthetic vocabularies, for about $0.0003 a request.

## 6. Semantic map colours (the professor's question)

The map colours papers by **neighborhood** by default. A neighborhood is a group the map finds by how close the papers' text embeddings are: k-means for 2 to 7 groups, kept only if the groups separate (silhouette ≥ 0.08). A repository of closely related papers, such as one programme's EIL research, or one with fewer than 5 papers, does not separate, so every paper gets one colour. The home page shows example data with distinct groups.

Changes:

- When the map has one neighborhood, it opens coloured by research area, or by year when there is one research area.
- The legend is always shown and says what the colour means.

## 7. What was built and what the checks found (2026-10-21)

**Charts:** `src/components/charts/` has the following.

- `Bars`: an axis, or one square per paper, and the Papers | % switch.
- `GroupedBars`: shares of each group, with the counts behind them.
- `StackedBars`, `YearColumns`, `LineChart`, `HeatGrid` (a blue scale with row totals), `DataTable`, `StatTile` and `Pie` (six parts or fewer).
- Shared pieces in `parts.tsx`.

`src/lib/charts/scale.ts` holds the arithmetic:

- The axis is the tightest rounded end of 4 to 7 steps.
- Squares are used up to 15 papers.
- A share under 1% keeps two decimals and shows as "<0.1%".

`InsightChart` draws every insight with these charts, including insights saved before this change. `ChatChartCard` draws every chart Chart mode reads from the papers, and Recharts is no longer used in the chat.

**Engine** (`src/lib/insights`):

- Every insight states its population.
- Comparisons keep their counts.
- Narrowed questions draw against all papers.
- A view whose values are all equal is a table, and a single value is a stat tile.
- `paperOverview` and `sharedValues` lead below 8 papers.
- The prompt version is now insights-v5, so cached write-ups are rebuilt.

**Rules the evaluation led to:**

- `normalizeQuery`: a grid with one column is a narrowing, and a change in a value among papers that all have it becomes that value's own change. Both were planned for real questions: "Which years had papers on Global Englishes?" and "Is interest in dynamic assessment declining?"
- A count of 1 or 2 papers is answered and drawn as squares. Grids and changes still need 3 papers.
- In grid cells on the dark page, text turns black only from 70% strength, where it reaches 4.5:1. The first cut-off, half strength, failed in between.

**Fixes the tests found:**

- "kind of studys" in a takeaway.
- The number of values that "pass the shift rules" was not stated as a fact.
- Theme names with digits ("L2 Writing") were read as claims, which also wrongly blocked a model's sentence. Insights now list their `mentions`.
- "None of the 1 papers".
- One paper of 5,000 showed as 0%.
- The axis ran to 15,000 for a top value of 10,190.

**Tests:**

- `charts-collections`: 20 collections × every view the menu allows, about 2,400 views.
- `charts-render`: 14 render tests.
- `chart-question-bank`: the bank's shape, and how the evaluation judges.
- Existing tests were updated where the charts' markup changed.

**Gallery:** `scripts/chart-gallery`, 47 specimens. `build.mjs` bundles them. `shoot.mjs` screenshots each one in light and dark at 1280 and 390 px and checks for overflow and overlapping text; it finds nothing.

**Planner evaluation:** `evals/chart-question-bank.json` has 106 requests, run by `scripts/evaluate-chart-planner.ts`.

- They cover years, themes, methods, research areas, kinds of study, contributions, aims, grids, change, narrowed, compared, vague, follow-ups, chart types, 14 reading kinds, 1, 2 and 6 papers, 1,500 papers, Thai, and off-topic or impossible requests.
- With GPT-6 Luna, 106 of 106 plans were right once `normalizeQuery` ran, for $0.029 of OpenRouter credit (103 live calls).
- The first, looser judging had passed three plans that drew the wrong chart (V21, V28, V44). The judge now requires the asked value itself.

**Found, not changed:** `likelyDuplicatePapers` treats two papers as one study when 80% of their title words match, so near-identical titles are counted once everywhere. Examples are "… among Thai EFL learners" against "… among Vietnamese EFL learners", or "Part 1" against "Part 2". The synthetic collections show it: 500 generated papers count as 458.
