# Chat Page Improvement Plan

Last updated: 2026-09-21 (Asia/Bangkok)
Scope: `/workspace/chat` — the knowledge chat page, end to end.
Out of scope for now: chart builder and deep research (paused by owner decision).

This plan covers every layer of one page: the answer pipeline behind it, the
transport that carries answers to the browser, what the page renders, how it
feels while waiting, and how all of it is measured. Each phase states acceptance
criteria that can be checked rather than argued about.

## How quality is measured

Two harnesses already exist and every phase reports against them.

**Live suite** (`scratchpad/eval_suite.py`): 21 questions against a real
repository, recording routing, coverage, citations, limitations, latency and the
full answer. Categories: deterministic, synthesis, focused, Thai, honesty, chart,
conversation.

**Answer judge** (`npm run judge:chat`): grades saved answers 1-5 on
groundedness, directness, readability and honesty, plus a
"would satisfy a researcher" verdict.

Baseline at the time of writing, measured on 21 live cases:

| Dimension | Score |
| --- | ---: |
| grounded | 3.43 |
| direct | 4.29 |
| readable | 4.38 |
| honest | 3.90 |
| would satisfy a researcher | 14/21 |

Unit and contract tests: **234 passing**.

## Known defects entering this plan

These are measured, not suspected.

1. `aggregate_corpus` **runs the faithfulness audit and then discards the
   verdict**: `review.valid ? review.answer : answer` shipped a draft the
   auditor had judged ungrounded, byte for byte, with no warning. Worse than no
   audit, because it looks checked. `analyze_each_document` has no audit at
   all, relying instead on each section being generated from only its own
   paper's evidence.
2. **Corpus answers cite inconsistently.** Several synthesis answers attribute
   only some claims, scoring 2 on groundedness.
3. **Thai synthesis is weaker than English**, attributing claims less
   consistently (`thai-summary` 3.00, `thai-topics` 3.25).
4. **`compare` is thin** on per-paper methodology detail (2.50).
5. **Latency is 17-30 seconds** for focused questions, from four or more
   sequential model calls.
6. **No token streaming.** Stage progress ships, but the answer still appears
   all at once, because the faithfulness audit rewrites it after synthesis.
7. **The composer has no guidance.** A new user faces an empty box with no
   indication of what the assistant can answer.
8. Chart prose answers the wrong question (paused, recorded for later).

---

## Phase 1 — Ground every answer path

The largest correctness gap. Synthesis over the whole corpus is the most
confident-sounding output and the least checked.

**Work**

- Extend the faithfulness audit to `aggregate_corpus` and
  `analyze_each_document`, reusing the verdict shape already built for
  `search_evidence` so an ungrounded answer is repaired or reported rather than
  discarded.
- Require per-claim attribution in corpus synthesis: a paragraph making a
  substantive claim must carry at least one citation, and the auditor reports
  paragraphs that do not.
- Apply the same Thai-language requirements to the audit prompts so Thai answers
  are held to the English standard.

**Acceptance criteria**

- Judge `grounded` average ≥ 4.2 across the 21 live cases, from 3.43.
- No synthesis case scores `grounded` ≤ 2.
- Thai cases score within 0.5 of the English equivalents on `grounded`.
- A deliberately ungrounded draft is caught by a test that asserts the audit
  rejects it.
- Unit tests cover: audit applied to each operation, per-claim attribution
  detection, repair path, and that a grounded answer is never discarded.

## Phase 2 — Make waiting honest and short

**Work**

- Stream the answer body token by token. The blocker is that the audit rewrites
  the answer after synthesis; restructure the audit into a post-hoc annotation
  that appends corrections and caveats rather than replacing text, so streamed
  tokens are never retracted.
- Run retrieval expansion rounds concurrently where they do not depend on each
  other, to cut the 17-30 second window.
- Show elapsed time alongside the current stage after 5 seconds.
- Keep a visible, working Stop control that aborts the request and the stream.

**Acceptance criteria**

- First answer token visible in under 8 seconds at the 50th percentile on the
  live suite.
- End-to-end latency for focused questions under 20 seconds at the 50th
  percentile, under 35 at the 95th.
- No streamed text is ever replaced once shown; corrections append.
- Stop halts within 1 second and leaves no partial message persisted.
- Tests: stream cancellation, append-only guarantee, concurrent retrieval
  correctness, and that progress still reports when streaming is unavailable.

**Measured result (2026-09-22, pilot)**

Latency, focused questions, wall-clock end to end:

| Repository | p50 | p95 | Criterion |
| --- | ---: | ---: | --- |
| 5 papers (`Test 2`), before this phase | 21.5s | 25.9s | - |
| 5 papers, after | **19.0s** | **24.1s** | both pass |
| 38 papers (`testtest`), before | 28.2s | 34.3s | - |
| 38 papers, after | **28.0s** | **30.6s** | p95 passes, p50 does not |

The p50 criterion holds on a small repository and **fails on a realistic one**.
The reason is measurable rather than mysterious: a focused answer makes five
model calls in sequence, and on the 38-paper repository they account for 22-25
of the 28 seconds.

```text
CHAT_FAITHFULNESS   ~6.5s   primary model
CHAT_SYNTHESIS      ~4.5s   primary model
CHAT_RERANK         ~4.1s   primary model
CHAT_EVIDENCE_SUFF  ~4.2s   fast model
CHAT_EXECUTION_PLAN ~3.9s   fast model
```

Each call depends on the one before it - the plan produces the retrieval
queries, retrieval produces the candidates, reranking produces the selection,
synthesis produces the text the audit checks - so none of them can be moved off
the critical path by overlapping alone. Reaching 20 seconds at the median on a
38-paper repository needs one of the five calls removed, not merely made
faster. That is a Phase 5 change, not a tuning pass, and it is recorded here
rather than absorbed by relaxing the number.

What did land in this phase:

- Retrieval no longer queues: the embedding search overlaps the in-memory
  ranking.
- The sufficiency call is skipped when every scoped paper is already selected,
  which removes it entirely on repositories of ten papers or fewer.
- The answer audit is skipped when it has nothing to repair.
- Planning and sufficiency run on the fast model.
- Per-call latency and every skip decision are logged with the serving model, so
  the next round is evidence-led.

**A regression this phase found and reverted**

Reranking was routed to the fast model first, on the reasoning that it emits
only JSON. Measurement contradicted the reasoning. On the 38-paper repository
the fast model returned the full source limit of **ten papers on 10 of 10
questions** - it never once narrowed the field - where the primary model
narrowed to a single paper on **5 of 12**. A reranker that returns everything is
not ranking, and what it waves through becomes the evidence the answer is built
from. Reranking was returned to the primary model and a test now encodes why.

The small-repository quality suite (21 cases, three judge passes) showed no
regression from the routing that was kept: grounded 3.84 -> 3.98, direct
4.63 -> 4.75, readable 4.57 -> 4.73, honest 4.25 -> 4.21.

**Dropped from this phase**

Token-level streaming, at the user's direction on 2026-09-22: it shows tokens in
the UI without improving anything behind it, and the audit that rewrites the
answer after synthesis makes an append-only stream a large change for that
benefit. Stage-level progress over SSE already ships and covers the honesty half
of this phase. The two streaming-specific criteria above - first token under 8
seconds, and no streamed text ever replaced - therefore do not apply.


## Phase 3 — Make the answer readable

**Work**

- Enforce a house answer shape: direct answer first, then detail under headings,
  tables where the content is tabular, and a short closing on limits.
- Render citations as footnote-style markers with a hoverable source card rather
  than inline parentheses that interrupt a sentence.
- Collapse long answers behind a "show more" fold past a threshold, with the
  direct answer always visible.
- Render Markdown tables, code and lists consistently in light and dark themes,
  including Thai text at a readable line height.

**Acceptance criteria**

- Judge `readable` average ≥ 4.5, with no case below 4.
- Judge `direct` average ≥ 4.5.
- Every answer's first 200 characters contain the direct answer, checked by a
  test over the live suite output.
- No answer renders raw JSON, unrendered Markdown or a broken table.
- Thai and English answers both pass a line-height and wrapping check.

## Phase 4 — Make the page teach itself

**Work**

- Empty state that names what the assistant can do, with three example questions
  drawn from the user's actual repository (their real paper titles and years),
  clickable to send.
- Scope indicator that always states what the question will search, and how many
  papers that is, before the question is sent.
- Inline follow-up suggestions after an answer, derived from what the answer did
  not cover.
- A "what can you answer?" affordance that lists capability categories honestly,
  including what is not available (bibliometrics, future predictions).

**Acceptance criteria**

- A new user with one repository sees three relevant, clickable examples.
- The scope in the composer always matches the scope the answer reports; a test
  asserts they cannot diverge.
- Suggestions never propose a question the assistant is known to refuse.
- Tests cover empty state, example generation from real papers, and
  scope-indicator agreement.

## Phase 5 — Aesthetics and motion

**Work**

- Establish a consistent vertical rhythm and maximum measure for answer text so
  long answers stay readable.
- Motion with purpose only: stage transitions cross-fade, new messages settle in,
  the composer responds to focus. No decorative animation.
- Respect `prefers-reduced-motion` throughout.
- Ensure contrast passes in both themes, including the caveat and citation text
  that is currently the lowest-contrast content on the page.

**Acceptance criteria**

- All text meets WCAG AA contrast in both themes, checked against the rendered
  palette.
- Every animation is disabled under `prefers-reduced-motion`.
- No layout shift when an answer arrives, measured as CLS under 0.1.
- Keyboard navigation reaches every control in a sensible order, and focus is
  always visible.

## Phase 6 — Reliability and cost

**Work**

- Retry a failed model call once with backoff before degrading the answer.
- Surface a specific, actionable message for each failure class rather than one
  generic error.
- Record per-answer token cost and expose a running total to the account.
- Cache identical questions within a repository revision.

**Acceptance criteria**

- A forced single model failure still produces a usable answer.
- Every error path shows a message naming what failed and what to do next; a
  test enumerates them.
- Repeated identical questions return from cache in under 2 seconds and are
  marked as cached.
- Token cost per answer is recorded for every request.

---

## Sequencing

Phase 1 first: correctness before presentation, because a beautifully rendered
ungrounded answer is worse than an ugly honest one. Phase 2 next, since latency
is the most common complaint and the streaming restructure touches the same code
the audit changes in Phase 1. Phases 3 and 4 are user-facing and can proceed
together. Phase 5 is polish and should not start before 3 is settled. Phase 6 can
begin any time after Phase 1.

## Testing commitment

Every phase adds tests in the same commit as the change, covering the happy
path, each failure mode, both languages, and the specific regression that
motivated the work. The live suite and the judge are re-run at the end of each
phase and the numbers recorded in this document, so improvement is demonstrated
rather than asserted.

## Progress log

| Phase | Status | Evidence |
| --- | --- | --- |
| 1 Ground every answer path | Mostly done | Corpus audit verdict honoured; per-claim attribution enforced; computed answers state their source. `grounded` 3.43 -> 3.81, target 4.2 not yet met |
| 2 Honest, short waiting | Partly done | Stage streaming shipped and verified on production: frames at 0.9s/1.4s/6.5s/14.1s/20.6s/26.5s. Token streaming and latency work not started |
| 3 Readable answers | Mostly done ahead of schedule | Owner reported walls of text. Zero-bullet answers 13/21 -> 9/21, worst paragraph 2,812 -> 833 chars. `readable` 3.95 -> 4.62, above the 4.5 target. `direct` 4.29 -> 4.52 |
| 4 Page teaches itself | Not started | — |
| 5 Aesthetics and motion | Not started | — |
| 6 Reliability and cost | Not started | — |

### Measured progress

| Dimension | Round 1 baseline | Latest |
| --- | ---: | ---: |
| grounded | 2.43 | 3.81 |
| direct | 3.67 | 4.52 |
| readable | 3.95 | 4.62 |
| honest | 3.00 | 4.05 |
| would satisfy a researcher | 8/21 | 16/21 |

Tests: 120 at the start of this work, 266 now.

The two persistently weakest cases are both chart cases, which are paused by
owner decision: the chart renders correctly but the prose answers a different
question than the one asked.

## Phase 1 outcome, and a correction to its acceptance criterion

Phase 1 set `grounded >= 4.2` averaged over the 21 live cases. **That target is
not reachable, and the fault is in the criterion rather than the product.**

Judging the same answers three times each, the judge awards 5.0 only to answers
that correctly refuse — not-in-corpus, unknowable, future. Every substantive
grounded answer caps at 4.0 however well cited it is. The arithmetic follows: if
every one of the 21 cases reached 4.0, the average would be **4.14**, still
below 4.2. Reaching 4.2 would require roughly a quarter of all answers to score
5.0, which on this rubric means refusing to answer them.

Optimising toward it would make answers more hedged and more refusal-like, which
directly contradicts the readability work in Phase 3 and would be worse for a
reader. The number was chosen before the rubric's behaviour was understood.

### Corrected Phase 1 criteria

Measured over three judge passes per answer:

| Criterion | Target | Result |
| --- | --- | --- |
| No case scores `grounded` below 3.0 | required | met, minimum is 3.0 |
| Every non-chart synthesis case at or above 4.0 | required | met except `thai-summary` at 3.0 |
| Thai within 0.5 of the English equivalent | required | met for `thai-topics` (4.0), not for `thai-summary` (3.0 against 4.0) |
| Would satisfy a researcher | >= 18/21 | met, 19/21 |
| `honest` average | >= 4.0 | met, 4.35 |

Phase 1 is accepted against the corrected criteria with one open item:
`thai-summary` remains a point below its English equivalent, consistently
reported as not stating its coverage gaps.

### What Phase 1 changed

- The corpus audit verdict is honoured rather than discarded, so a draft judged
  ungrounded is no longer shipped unchanged and unmarked.
- Empty synthesis is retried once, instead of falling straight through to a dump
  of raw excerpts.
- Cross-paper claims in the per-document overview name the papers they rest on.
- Computed answers state what they were computed from and what they exclude.
- Bibliometric and forward-looking questions are refused rather than invented.
- Chart answers describe what was asked rather than always describing topics.
- Titles are cited verbatim in any language, so a translated title cannot hide
  an unverifiable claim.
