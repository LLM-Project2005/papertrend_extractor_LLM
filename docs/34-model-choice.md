# Model choice for chat and deep research (2026-10-09)

GPT-5.6 Luna was replaced by GPT-6 Luna everywhere it ran, and GPT-6 Luna now also runs the chat's planner and sufficiency check, which were on Gemini 3.7 Flash. This page records why, and the one problem the switch exposed.

## Prices

OpenRouter, per million tokens, read on 2026-10-09:

| Model | Input | Output | Notes |
| --- | --- | --- | --- |
| GPT-6 Luna (`openai/gpt-6-luna-20260922`) | $0.10 | $0.50 | released 2026-09-23 |
| GPT-5.6 Luna (`openai/gpt-5.6-luna-20260709`) | $0.20 | $1.20 | the previous main model |
| Gemini 3.8 Flash | $0.75 | $3.75 | reasoning billed at the output price |
| Gemini 3.7 Flash | $0.75 | $3.75 | reasoning billed at the output price |
| Gemini 3.1 Flash-Lite | $0.25 | $1.50 | |
| Gemini 2.5 Flash-Lite | $0.10 | $0.40 | paper analysis |

## What was measured

The chat ran locally against the live test repository (41 papers) with the production code, on five questions: three focused ones (peer feedback, dynamic assessment, reported limitations), one comparison across papers (reading assessment methods) and one whole-repository overview. GPT-5.6 Luna results come from the CHAT-8 runs of 2026-10-04 (docs/32).

| Variant | Answer, reranker, audit | Planner and sufficiency check | Cost of the 5 questions |
| --- | --- | --- | --- |
| Before | GPT-5.6 Luna | Gemini 3.7 Flash | about $0.10 |
| V1 | GPT-6 Luna | Gemini 3.7 Flash | $0.051 |
| V3 | GPT-6 Luna | Gemini 3.8 Flash | $0.050 |
| **V2, chosen** | **GPT-6 Luna** | **GPT-6 Luna** | **$0.030** |

- **Quality.** On the focused questions GPT-6 Luna's answers were as grounded as GPT-5.6 Luna's: the same papers, cited the same way, and the same plain statement where the evidence held no outcomes. On peer feedback it also found a related result the earlier answer missed.
- **Speed.** Planning took 3–5 s on all three planners, and whole answers took about as long as before. Gemini 3.8 Flash was not faster than GPT-6 Luna.
- **Cost.** Gemini bills its reasoning at the output price, $3.75 per million, so on the planner alone it cost more than GPT-6 Luna's whole answer.

## The problem it exposed: reasoning against the output limit

GPT-6 Luna reasons before it writes, more than GPT-5.6 Luna did, and the reasoning counts against each call's `max_tokens`. At the limits set for GPT-5.6 Luna, it was cut off (`finish_reason: "length"`):

- the reranker at 450 tokens, so the answer fell back to plain keyword ranking;
- the whole-repository group summaries at 1,500, one of them empty;
- the audit once at 3,600, so that answer was not checked.

Every step on the reader's model now has room (`STEP_BUDGETS` in `src/lib/repository-chat.ts`), and the mechanical ones (choosing papers, summarising a group, the web step) are asked to reason briefly. Afterwards no call was cut off: the group summaries' reasoning fell from 500–1,500 tokens to 150–250, and the overview cited all 41 papers and was checked supported and complete for $0.011, against $0.0255 on GPT-5.6 Luna. A limit is a ceiling, not a charge; only tokens used are paid for. Deep research's limits were raised the same way.

One deep research run on the whole test repository ("What do these papers find about feedback, and how do their methods differ?") then completed in 42 s for $0.0135, against a median of $0.023 on GPT-5.6 Luna (docs/31), with no call cut off. GPT-6 Luna's plan, three findings calls, report and revision cost $0.0054; Gemini 3.8 Flash's claim check cost $0.0081. Checking with GPT-6 Luna as well would roughly halve a run's cost, but the report would then be checked by the model that wrote it.

## Decisions

| Step | Model |
| --- | --- |
| Chat answer, reranker, audit, group summaries | GPT-6 Luna |
| Planner, sufficiency check | GPT-6 Luna (`DEFAULT_FAST_MODEL`; `CHAT_FAST_MODEL` overrides it, `off` uses the reader's model) |
| Chat model picker | Removed: one model. The reranker runs on the reader's model, and Gemini Flash never narrowed the evidence (docs/25), so offering it weakened answers. A second entry in `MODEL_OPTIONS` brings the picker back. |
| Deep research: plan, findings, web, report, revise | GPT-6 Luna |
| Deep research: claim check | Gemini 3.8 Flash, a different family from the writer; same price as 3.7 |
| Chart view, Adaptive write-up | Gemini 3.1 Flash-Lite, unchanged: tiny calls, already tested |
| Reclassification, paper analysis | Gemini 2.5 / 3.1 Flash-Lite, unchanged: they must match each other, and changing them needs the pipeline evaluation (docs/29) |

Model spend for the measurement: $0.176 ($0.162 for the chat, $0.0135 for the deep research run).
