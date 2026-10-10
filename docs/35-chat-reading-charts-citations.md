# Chat: reading whole papers, charts of what papers report, passage citations (2026-10-10)

The aim of this round: a research chat that a researcher would choose over a general notebook tool for questions about their own papers. That means three things the chat did not do well: read the papers properly, chart what the papers actually report, and show the exact passage behind every claim. Measured on the test repository (41 records, 36 distinct studies) with GPT-6 Luna.

## 1. Answers read whole papers

An answer saw one passage of at most 1,400 characters from each paper, and a paper-by-paper explanation the first 900-1,200 characters of four stored parts: about a twentieth of an article. Asked to explain one paper, the chat said its methods were "truncated".

- `lib/paper-reading.ts` lays each paper out by its printed sections, without references or acknowledgements, and reads it whole when the papers fit the effort's budget: 16,000 characters at Low, 64,000 at Medium, 240,000 at High. Over budget, each paper gets a fair share (a short paper gives the rest back): its abstract, then the passages that best match the question, in reading order with `[…]` where text was left out.
- The per-paper explanation reads the same way and is told when it read excerpts, so it says a detail "is not in the parts read" rather than that the paper does not report it. Its batches run three at a time.
- Replies no longer open with a "Direct answer" heading, and later parts of a multi-part reply are headed in the reader's words ("What the papers say", "The chart").

## 2. The reranker's choice is kept

Every rerank was being thrown away. GPT-6 Luna explains its choice in 1,000-1,700 characters; the schema allowed 500, so the reply failed validation and the answer read the sixteen papers the keyword ranking put first, each in a slice of about 9,000 characters. That is why High wrote that papers "did not report" sample sizes and statistics they did report.

- Model replies are now cut to size rather than refused (reranker, planner, sufficiency check).
- A second search adds at most four papers to the reranker's choice; it used to refill to twenty.
- An evidence answer that also asks about "each" study analyses the studies the answer draws on, not every paper in scope. A comparison of four writing studies had appended an analysis of all 41 records.
- Two uploads of one paper (same title and year, even when the files differ) are one study for ranking, per-paper analysis, repository summaries and charts.
- A follow-up's writer reads the previous answer up to 8,000 characters (it was cut to 1,200).

| High, writing-intervention comparison | Before | After |
| --- | --- | --- |
| Time | 230 s | 97 s |
| Cost | $0.054 | $0.017 |
| Answer | 49,754 characters, 41 citations | 4,199 characters, 4 citations |
| Reranker | fallback | used |

Medium on the pronunciation question: 3 relevant papers cited, with the specifics (1,176 tokens from 49 students; 10 + 10 learners; 10 British judges), $0.007, 65 s.

## 3. Chart mode charts what the papers report

Chart mode could count papers by theme, method or year, and count words. Asked how many people took part in each study, where the studies were done or for a paper's results table, it refused or drew a keyword chart.

One planning call (`lib/chart-reading.ts`, GPT-6 Luna) now chooses between the dashboard's views and reading the papers:

- **values**: one value per paper, a number (participants, duration, a score) or names (country, instruments, statistical tests). Papers are read in batches at the effort's depth.
- **paper_table**: the figures in one to three named papers' tables or results.
- **length**, **sections**, **terms**, **keywords**: computed from the text as before.

What the model reads is checked in code before it is charted. A value is kept only when its quoted sentence is in the paper (word for word, allowing punctuation and case) and its number is printed in that sentence next to the same word. A total the paper gives only in parts is kept when each part is in the sentence and they add up. Figures from a table are kept only when every number is printed in the paper. The chart, its summary and every number in the reply are computed, and each value is listed under the chart with the paper's own sentence; clicking it opens the paper's PDF at that sentence. When papers name things differently ("Interview", "Interviews", "Semi-structured interview"), one small call groups the names; the source list keeps each paper's own words.

| Question (Medium) | Result | Cost, time |
| --- | --- | --- |
| How many participants did each study have? | 36 of 36 studies read, 32 values checked, median 42 | $0.014, 21 s |
| Have sample sizes changed over the years? | median by year, earlier vs later half compared | $0.015, 20 s |
| Which countries were the studies conducted in? | Thailand 19, China 1, Vietnam 1 | $0.015, 19 s |
| แต่ละงานวิจัยใช้เครื่องมือวิจัยอะไรบ้าง (Thai) | answered in Thai; questionnaires 19, tests 18, interviews 16 … | $0.017, 39 s |
| Which research methods are most common? | dashboard view, no reading | $0.001, 7 s |
| Main results table of one paper | 10 rows of means and SDs, each with its printed row | $0.002, 18 s |

A table printed as an image reaches the text without its numbers; the reply says so rather than inventing them.

## 4. Citations quote the passage behind each claim

A citation marker named the paper and nothing more. Each paper citation now carries the passage that supports the sentence citing it: one to three of the paper's sentences (at most 400 characters) from the text the answer read, found after the answer is written with no model call (`lib/citation-passages.ts`). The citation card quotes it, and "Show in paper" opens the paper's PDF in place with the passage marked. The Sources panel and the Markdown export quote it too. Deep-research reports quote the passages they were written from.

## 5. A new Max engine

Max ran the deep-research engine (docs/31) in the conversation. Measured on four questions against High, it did not beat it: High won two, Max one, one tie. Max read 1,100-character passages, at most two per paper and eight per sub-question, so it attributed what papers said in their literature reviews to the papers themselves, wrote that papers did not report details they did, and its claim check deleted correct numbers. The engine was replaced, keeping its sessions, steps, progress line and citations.

1. **Choose.** One call plans the question over a card per study (duplicate uploads merged) while High's own plan and evidence selection run alongside. Max reads the planner's core picks, then any High chose that the planner missed, then the planner's related picks: never fewer relevant papers than High. At most 20 papers, 16 of them whole.
2. **Read.** Each paper is read in its own call, whole (references left out): up to ten facts, each with verbatim quotes and its section, marked as the paper's own result or a study it cites, plus its stated limitations and the details it does not report.
3. **Check, in code.** A fact is kept only when its quote is in the paper and its numbers are in its quote.
4. **Write.** One high-reasoning call from the checked facts: the answer first, one compact table when studies are compared, each study's sample, design and main statistic, a broad question answered point by point, and "not reported" only for a paper read whole. About High's length (350-750 words; at most 1,000 for a broad question), with one shortening pass when it runs over.
5. **Check the answer.** Every number must be in what its sentence cites; only failing sentences are rewritten. How many papers were read is added in code afterwards.

| Question | High | Max | Verdict |
| --- | --- | --- | --- |
| Pronunciation problems and how they were measured | 4 studies, 92 s, $0.017 | 5 studies in one table, judges' means, voicing counts; 83 s, $0.025 | Max better |
| Writing interventions compared | 112 s, $0.018 | table with each study's means and statistics (49.93 → 69.47 → 72.13, F = 83.54); 128 s, $0.023 | Max at least level |
| Blended and flipped learning (Thai) | 92 s, $0.018 | task-level t-tests, per-aspect medians, inter-rater correlations; 87 s, $0.026 | Max better |
| Gaps for assessment research (broad) | tight priority list; 125 s, $0.012 | priorities, each with its studies' numbers; 175 s, $0.053 | Max more specific, High shorter |

Every checked number in the Max answers verified against the paper text (about 65 spot checks across the rounds).

## Cost

This round's evaluation spend on OpenRouter, as reported: about $0.22 for the Chart mode and High checks, and $0.72 across the Max vs High rounds, about $0.94 in all.
