# A second chat model: GPT-6.1 Sol (2026-10-22)

> **Withdrawn on 2026-10-24.** On the professor's review, Sol was removed from the model list because it used too much of the allowance (docs/40, section 2). A request or a saved Max plan that names Sol is answered by GPT-6 Luna. Sol's prices stay in `model-prices.ts`, so the use already recorded is still counted at its price. The rest of this file describes the version that shipped on 2026-10-22.

Readers can now choose GPT-6.1 Sol beside GPT-6 Luna in the chat's model and effort control. Luna stays the default. Sol counts against the daily allowance at its price over Luna's (the professor's rule), so the allowance is counted in "Luna tokens".

## 1. The model and its price

Sol is `openai/gpt-6.1-sol-20260929`, pinned by its dated name as Luna is (`openai/gpt-6-luna-20260922`). OpenRouter's listing on 2026-10-22, in US dollars per million tokens:

| | Input | Output | Cached input | Cache write |
| --- | --- | --- | --- | --- |
| GPT-6 Luna | 0.10 | 0.50 | 0.01 | 0.125 |
| GPT-6.1 Sol | 2.00 | 10.00 | 0.10 | 2.50 |
| Sol over Luna | 20x | 20x | 10x | 20x |

Over 272K prompt tokens both prices double, and the ratios stay the same. GPT-6.1 Sol was chosen over GPT-6 Sol because it has the same input and output price and its cached input costs half.

A three-call probe (about $0.013) confirmed the following. The dated name is served. A call with no cache breakpoint pays no cache write. The marked opening is written once (2,641 tokens) and read at the cached price on the next call. OpenRouter's charged cost matched the table exactly.

## 2. How the allowance counts

`src/lib/model-prices.ts` holds one price table. Cost estimates (`answer-cost.ts`) and the allowance both read it.

- **How a token counts.** Each recorded model call counts as many Luna tokens as it costs, kind by kind. Luna counts one for one, as before.
- **Sol.** Sol counts 20 per input, output or cache-write token, and 10 per cached input token. The cache split comes from the provider's `prompt_tokens_details`. Without it, every prompt token counts 20, so Sol is never counted at less than it cost.
- **Other models.** Every other model counts at its own price over Luna's. Gemini 3.1 Flash-Lite (the chart query step and the Adaptive write-up) counts 2.5x Luna's input and 3x its output. Embeddings count 0.2x. Before this change both counted one for one.
- **Unknown models.** A model missing from the table counts as an expensive one ($2.50 / $10), so it is never under-counted.
- **Adding a model.** A later model needs only its prices added to the table.

## 3. Before a Sol request starts

A request on a model dearer than Luna is checked against what is left today, before the question is saved (`assertModelAllowance`). If what is left will not cover a usual request, the reader is told why and what to do instead. A Luna request keeps the old rule: it may start while anything is left. No answer is cut off once it has started. The output limits (STEP_BUDGETS) are unchanged.

"Usual" is the median from the question bank's saved Luna runs (2026-10-11), times the model's ratio (`TYPICAL_LUNA_USAGE` in `chat-models.ts`):

| Request | Luna | Sol | Share of today's 1,000,000 |
| --- | --- | --- | --- |
| Low | 15,000 | 300,000 | 30% |
| Medium | 35,000 | 700,000 | 70% |
| High | 95,000 | 1,900,000 | 190% (cannot fit in one day) |
| Chart | 10,000 | 200,000 | 20% |
| Max (Sol writes) | 200,000 | 532,500 | 53% |

The saved runs also give each Sol estimate in dollars. A Medium answer is about $0.07 (up to $0.27 for a broad question). A High answer is about $0.19.

With the allowance at today's `AI_DAILY_TOKEN_LIMIT` of 1,000,000, a person can ask about one Sol answer at Medium a day, and Sol at High never fits. Raising the limit is a policy decision; it is one environment variable.

## 4. Max with Sol

Max (the research engine) runs as follows when Sol is chosen:
- **Who does what.** GPT-6 Luna plans and reads the papers. Sol writes the answer from Luna's notes and makes its corrections. The plan saves the writer on its write step (`sessionWriterModel`).
- **Why Sol only writes.** Reading every paper on Sol would cost about 20x a Luna run, 2.9M Luna tokens or more, several days' allowance. The writer reads only the notes, 8,000 to 24,000 tokens in the runs measured, so a Sol Max run is about 2.5x a Luna one: roughly $0.05 for a focused question and $0.11 for a broad one.
- **The Max cap.** A Sol run counts as one of the day's 10 Max answers, like any run. Its Sol tokens count at 20x in the allowance. A run that what is left cannot cover is not started and costs no Max unit.

The chart planner keeps its own model (Luna) whatever the reader chooses. Luna planned 106 of 106 bank requests right (docs/38).

## 5. What the reader sees

- **Model list.** It reads "GPT-6 Luna, By OpenAI." and "GPT-6.1 Sol, By OpenAI. About 20x usage." Ask again offers both.
- **Max note.** At Max with Sol, the control says "At Max, GPT-6 Luna reads the papers and GPT-6.1 Sol writes the answer."
- **Usage meter.** It shows what is left ("73% left"), and how many Medium answers that covers on each model. Each daily limit is shown as "N of M left".

## 6. The monthly budget alert

This month's AI spend for the whole site is every account's requests plus paper analysis, from the `ai_usage_events` rows. It is compared with `AI_MONTHLY_BUDGET_USD` (default $100):
- **At 80%.** The web service logs `ai_monthly_budget_80`, at most hourly per instance. An alert policy in `scripts/ops/apply_monitoring.py` emails the owner once the script is run.
- **Admins.** They see the month in the usage meter.
- **Nothing is refused because of it.** The daily limits do that.
- **Limitation.** Evaluation runs on the same OpenRouter key leave no row, so OpenRouter's own figure can be a little higher.

## 7. Not yet done

The paid evaluation waits for OpenRouter credit:
- About 10 chat questions on Sol, which would check answer quality and whether Sol's reasoning fits the STEP_BUDGETS limits.
- The 106-request chart planner bank, if it is still wanted. The planner does not run on Sol in the product.
