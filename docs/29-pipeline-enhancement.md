# 29 — Analysis pipeline enhancement

Status: **phases 0–7 done on the pilot; promotion to production waiting** (2026-09-26)

## The question this answers

After docs/28 the dashboard draws what it is given honestly, so its ceiling is the per-paper
analysis. The brief: analyse every stage of the pipeline, keep its concept, fix what stops the
concept working, add what it lacks, and measure before and after.

The concept is unchanged: extract → clean → translate → segment → (metadata, author keywords,
keywords → topics → labels → classification, typology, facets) → dataset → one save → dashboard
themes (docs/28).

## How it was measured

`scripts/evaluate_pipeline_quality.py` runs the real graph with the production model preset on a
fixed set of 14 papers (`tests/fixtures/pipeline-eval/manifest.json`: long and short articles,
scanned PDFs, a Thai paper, three duplicate uploads, the undated and truncated-title cases). Gold
titles, years and author keyword lists were read from each PDF's first page. Four papers run twice
to measure run-to-run variation. Scoring makes no model calls, so saved runs can be re-scored and
compared for free. PDFs and extracted text are cached locally, never committed.

```
python scripts/evaluate_pipeline_quality.py run --out <dir>              # costs about $0.15
python scripts/evaluate_pipeline_quality.py compare <before> <after>
```

The metric rules were fixed before the baseline. Two scorer bugs found afterwards were fixed and
both runs re-scored: an introduction probe cut mid-word, and a concept-frequency check that counted
"EMI" again inside "English-medium instruction (EMI)".

## Results

| Criterion | Baseline (today's code) | After |
| --- | --- | --- |
| Classification stored, with rationale | 0% | 100% |
| Title correct | 86% | 100% |
| Year correct / wrong years | 21% / 1 | 100% / 0 |
| Introduction read by the keyword step | 23% | 100% |
| Bibliography read by the keyword step | 93% | 0% |
| Keywords / evidence found in the text | 98% / 96% | 100% / 100% |
| Keyword frequency matches a count of the concept (±1) | 67% | 99% |
| The paper's own keywords recovered | 68% | 99% |
| Subject topics carrying method terms | 19% | 2% |
| Topic labels of 2–5 words | 99% | 99% |
| Keywords / topics per paper | 13.3 / 3.6 | 12.2 / 5.9 |
| Median cost per paper | $0.0126 | $0.0085 |
| Median model calls / graph time | 11 / 19 s | 9 / 13 s |

Evaluation spend in total: about $0.85 (baseline with one-time OCR $0.34, three runs after).

Frequency is stored as the concept's count across its surface forms, which is what the field
always documented; the stricter "exact phrase only" count agrees 36% of the time, by design.

## What was wrong, and what changed

**Correctness (phase 1).**
- LangGraph drops state keys the graph does not declare. `category_classification` was never
  declared, so every paper got two default "Other" rows — in an EIL or custom repository, every new
  paper showed as Other. All node outputs are now declared; `tests/test_ingestion_state_contract.py`
  runs each node and the whole graph from a PDF and fails if any output key is undeclared.
- The year resolver discarded correct years: a journal issue line ("Vol 28, No 2, May–August
  2021") did not count as publication evidence, the model agreeing did not help, a web title search
  overrode the front matter (discourse-markers: 2024 for a 2022 paper), and ISSNs and e-mail digits
  were read as years. All fixed; Thai issue lines and thesis cover years work; a user correction wins.
- Unparseable structured output was returned as nothing. It is now retried once with the problem
  spelled out, then sent to the other Flash-Lite model (paper-analysis tasks only).
- Every fallback leaves a warning, stored with the run as `analysis_quality`.
- A paper's rows are saved in one transaction. Deep research on Cloud SQL crashed on a missing import.

**What the analysis reads (phase 2).** Segmentation asked the model for character offsets in up to
48,000 characters — which cut titles and was skipped for over half the papers. It now sends a
numbered outline of heading lines, at any length, for a fraction of the tokens. The keyword step
reads the introduction and literature review and never the bibliography. Titles come from the first
page. Long Thai documents are translated section by section instead of not at all.

**Keywords, topics, labels (phase 3).** Keywords must appear in the text and are counted; subject
and method are tagged; the paper's own keyword list joins before grouping. Grouping no longer forces
3–6 families of at least three; acronyms merge only when the paper defines them. One labelling call
per paper names each topic in the paper's own words. Typology runs after labelling and uses a
general four-group wording outside EIL repositories. The worker and the reclassification job share
one classifier contract (`tests/test_classifier_contract.py`).

**Re-analysis and corrections (phase 3b).** The library can analyse a paper or a whole repository
again (same run id, so the paper id stays), with the cost shown. Title and year corrections are
stored on the run and survive re-analysis.

**Duplicates (phase 4).** Each paper's text gets a MinHash fingerprint; an earlier copy in the same
repository is noted on the run and in the library. Different papers in the evaluation set score at
most 0.02 against a 0.8 threshold.

**Showing it (phase 5) and dashboard fixes (phase 6).** The paper view shows where the year came
from, the research type, the paper's own keywords, methods, and any analysis notes. The Adaptive
fallback, KPI counts, category names, concept-search quota and timeline, heatmap dark mode, the
empty-repository spinner and Refresh caching were fixed; unused code was removed.

## No schema change

Every new per-run fact (analysis quality, topic kinds, fingerprint, duplicate, user corrections)
is stored in `ingestion_runs.input_payload`. The typology table's 1–4 group check is kept by using
the same four-group shape in general repositories.

## Phase 7 — the test repositories analysed again

An on-demand Cloud SQL backup was taken first (`1790363731023`, 2026-09-25 19:15 UTC). Test 2 (5
runs) and testtest (38 runs) were then analysed again on the pilot, and the dashboard was read
before and after.

| testtest | Before | After |
| --- | --- | --- |
| Papers with a category (EIL profile) | 0 of 38 | 38 of 38 (27 ELI, 7 EL, 4 LAE) |
| Undated papers | 2 | 0 |
| Runs with an analysis-quality record | 0 | 38 (7 note a degraded step) |
| Themes / method themes | 46 / 7 | 77 / 14 |
| Themes with a single paper | 44% | 44% |
| Largest theme, share of papers | 13% | 18% |

The degraded steps say what happened: scanned PDFs read by OCR (24 of 25 and 24 of 27 pages), a
246-page thesis past the 80-page limit, and topic labels that fell back to a member phrase.

Model cost as recorded on the runs: $0.65 for the 43 re-analyses ($0.015 per paper — these are
longer than the evaluation set), $0.04 for one paper tried again, $0.01 for the live upload check.
Reclassification and theme regrouping add a few cents; they are not recorded per call.

**What it found, and fixed:**
- *Old runs had no analysis profile.* Papers uploaded before profiles existed carried
  `analysis_profile: null`, so the classifier had no categories and re-analysis left 37 of 39 "Other".
  Re-analysis now takes each repository's current profile on the server, as an upload does, and
  its repository id (without which category rows were saved with no repository and not counted).
- *Reclassification had never run on Cloud SQL.* Its paper list sorted a `SELECT DISTINCT` by a
  column it did not select, and its publish step collided with category rows saved without a
  repository. Both fixed; testtest was reclassified with its EIL profile for a few cents instead of
  analysing it a third time.
- *A failed re-analysis marked a good paper failed.* One momentary database disconnect did this; the
  paper's rows were intact (one transaction per paper). The paper now keeps its earlier results and
  the attempt is noted; a failed paper can be tried again from the Library.
- *Participant groups became topics.* The keyword prompt listed populations as subjects, so nearly
  every paper got a "Thai EFL undergraduate students" topic and the dashboard merged them into
  "EFL Learner Characteristics and Demographics" — 29 of 39 papers (74%). A phrase whose head noun
  names people ("Thai EFL learners", "learners of English", Thai head-first forms) is now not a
  concept, in the pipeline and when the dashboard builds topics, so stored papers read correctly
  without being analysed again. "Learner autonomy" and "EFL learners' writing" are still subjects.
- *Rounded paper ids.* `input_payload.paper_id` is a 60-bit number; any JavaScript round trip rounded
  it (14 of 44 runs on the pilot), breaking the Library's title join and dashboard links to a paper.
  Paper ids are now resolved from the run, and a Library copy keeps its payload in SQL.

## Still to do

1. Promote to production.
2. Evaluation set re-run for the keyword prompt change (participant rule) if the numbers above are
   to be restated; the rule itself is deterministic and tested.
