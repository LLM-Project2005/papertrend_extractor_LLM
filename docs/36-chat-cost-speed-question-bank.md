# Chat: High and Max cheaper and faster, and a question bank for every kind of question (2026-10-11)

Two aims: make High and Max answers cheaper and faster with the same or better answers, and test the chat - every feature, Chart mode included - on many kinds of question rather than a handful. Measured on the test repository (41 uploads, 36 distinct studies) with GPT-6 Luna. OpenRouter credit was low, so every model reply was cached on disk and re-runs paid only for what a change touched; answers were judged by reading them, not by a model judge. Evaluation spend for the round: $0.55 of OpenRouter credit.

## 1. Where the money went, and the provider's cache

Every call to GPT-6 Luna was charged 1.25 times its input price. For GPT-5.6 and later, OpenRouter caches every prompt by itself and charges a quarter more to write it; nothing here ever read one back (`cache_write_tokens` equal to the prompt, `cached_tokens` 0, on every call). With explicit caching, a call with no mark is not cached and pays the plain price, and a marked opening is written once and read at a tenth.

- `lib/openai.ts`: GPT-5.6+ calls on OpenRouter go out with `prompt_cache_options: {mode: "explicit"}`; a message marked `cachePoint` ends a cached opening. Every chat, chart and Max call stops paying the 25%.
- An answer and its check now open with the same messages - the contract with the repository's summary, then the papers read (`sharedReading`) - so the check reads about 54,000 tokens of papers from the cache: about $0.0005 instead of $0.0068. The next question in the same repository reads the summary from the cache too.
- Measured on four tiny calls first (`cache_probe`): 1.25x with automatic caching, 1.0x with it off, 0.12x for a cached opening read again.

## 2. High

- **One call instead of two to choose the papers.** The reranker also says whether its choice is enough and what to search for if not; the separate check (4-6 s, about $0.0005) runs only when the reranker does not say. It widened the search on the same questions as before.
- **Confidence read from words.** The answer model writes its confidence as words ("moderate-high", a sentence in Thai) and anything but a bare word read as 0.5 - below the 0.75 an answer needs to skip its check. In production 15 of 27 answers were checked for "low confidence" this way. Words and numbers in a sentence are now read, and the model is asked for a number.
- **The check answers in JSON.** Given the papers first and the draft last, the check once replied with a rewritten answer instead of its verdict, the draft's confidence read as 0.5, and the reader got "I could not finish this answer" for a good Thai answer. The answer and the check now use JSON mode.
- The answer step keeps high reasoning: medium was 20-30 s faster and about $0.001 cheaper, but kept fewer of the papers' figures (the tone-group percentages on the pronunciation question).

| High, benchmark question | Before | After |
| --- | --- | --- |
| Pronunciation | $0.0172, 92 s | $0.0112, 56 s |
| Writing interventions | $0.0178, 112 s | $0.0117, 81 s |
| Blended learning (Thai) | $0.0179, 92 s | $0.0114, 65 s |
| Assessment gaps (whole repository) | $0.0119, 125 s | $0.0102, 120 s |

Times are local runs; production's model time is about half. The answers cover the same studies with the same figures; one of four cited three pronunciation studies where the old answer cited four (run-to-run variation; the reranker widened the search both times).

## 3. Max

- All the papers are read at once (twenty at a time instead of ten): the second wave was waiting time only.
- Each paper is read at low reasoning and the answer written at medium (`REASONING` in `deep-research/types.ts`). On the same papers the answers were as specific - the same studies, numbers and tables - and code still checks every quote and number a reading records. Reading one paper took at most 12-13 s (22-29 s before); writing 13-25 s (35-58 s).
- The sentence check no longer splits a study named in bold whose title ends in a question mark; it had rewritten half a sentence and left "(2011)** developed and piloted…" dangling.

| Max, benchmark question | Before | After |
| --- | --- | --- |
| Writing interventions (focused) | about $0.024, 128 s | $0.019, about 40 s |
| Assessment gaps (broad, 15-20 papers) | $0.053, 175 s | $0.037, about 60 s |

Max still beats High on these: on the writing question it gives the portfolio study's draft-by-draft gains, which High reported as "not available".

## 4. The question bank

`eil-dashboard/evals/chat-question-bank.json`: 48 chat questions (fact about one paper, method, summary, named paper, synthesis, comparison, listing by property, counting by topic, repository statistics, years, per-paper analysis, word counts, trends, gaps, definitions, quotes, numbers, unanswerable, general knowledge, small talk, ambiguous, recommendations, critique, agreement, instruments, theory, multi-part, bullet and table formats, year-scoped, Thai, follow-ups, a language switch, Low and High effort), 22 Chart mode requests and the four benchmark questions. Each says which planner steps are acceptable and which facts the answer must state. `scripts/evaluate-chat-questions.ts` runs any of them, caching every reply; `PLAN_ONLY=1` checks routing alone for about $0.0003 a question.

First run, on the code above, at Medium: 36 of 48 answers were right, specific and cited; none missed a required fact or the language. What failed, and the fix:

| Questions | What happened | Fix |
| --- | --- | --- |
| Which studies used a pretest-posttest design? Which papers studied school students? How many papers are about assessment? Does any paper report an effect size? | A focused search reads the ten highest-ranked papers: 6 of 12, 4 of 8, no count, 3 of 8 - each written as if complete | **Screening** (`lib/paper-screening.ts`, planner step `screen_papers`): every paper is checked against the condition in a short read, twelve to a call, and each match quoted and verified. Now 12 of 12, 8 of 8, 12 assessment studies, 8 papers with their effect sizes; about $0.004 and 10-15 s. A matching paper whose short read lacks a detail the question asks for is read again, longer, for that detail. A table is drawn when one is asked for |
| For each paper, give its research design in one line | Each batch of six wrote its own overview ("only six of the 41 are represented here"); six of them opened the answer | One overview written from every paper's analysis |
| Which paper is the longest? | Sent to a 41-paper analysis: 18,000 characters, $0.014 | Counted from the stored text, $0.0003 |
| Which year has the most papers? | A table with no answer; the chat said 2022 had 10 papers while Chart mode said 6 | Answers first, and counts each study once, as the dashboard does, saying how many uploads are second copies |
| Make a table of the writing interventions | The planner added the chart step, which read every paper for one value and drew a "participants and weeks" chart ($0.012) | A table asked for in an answer is written in it; screening draws it |
| Repository-wide summaries and counts | "Does not cover 5 of the 41 papers" - the five are second uploads; "the four batch subtotals" | The synthesis and its check are told the uploads were read once; batches are never mentioned |
| How many studies are quantitative, qualitative or mixed? | Once screening existed, the planner sent this breakdown to it | One condition is screening; a breakdown is a repository summary |

Chart mode, 22 requests: the planner read 21 sensibly - years, themes, theme change over time, word counts, length, sections, participants, countries, instruments, education level, durations, first languages (a pie), effect sizes, a single paper's results table, and a polite refusal for "the weather in Bangkok". Two were fixed:

- "Chart the research approaches: quantitative, qualitative or mixed" was declared unanswerable because the dashboard records methods as topics. The planner now reads the papers when no view holds what is asked (23 of 36 papers state an approach) - but still declines, without reading, anything that is not about the studies.
- "Show the top keywords" counted the word "keywords". A word that names what to count is no longer a term to count unless quoted.

Value charts were right against the papers: intervention lengths (11 interventions, 4 to 17 weeks) and research approaches this round, participants and countries in docs/35.

## 5. Also found

- A regular expression in `repository-chat.ts` held two backspace characters where `\b` was meant (an editing script's escape), so "sections" never matched in the chart step. Fixed. Two test files carry the same slip (`tests/semantic-map-labels.test.ts:144`, `tests/site-ui.test.ts:41`), so those assertions cannot fail; they are outside the chat and left as they are.

## Known limits

- Screening reads about 4,000 characters of each paper; a condition stated only deep in a paper's results can be missed, and the list says it checked "from its abstract and the passages that bear on the question".
- A chart of one value for a few named papers ("the dynamic assessment studies") still reads every paper in scope.
- Run-to-run variation: the same question can cite three or four studies on different runs.
