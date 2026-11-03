# Papertrend documentation

The documents here come in two kinds.

- **Reference chapters (01 to 09)** describe the system as it runs now. Read
  these first. They are also joined into one file,
  [PROJECT_DOCUMENTATION.md](../PROJECT_DOCUMENTATION.md).
- **Round records (10 onward)** were written as each round of work was planned
  and shipped, from June to November 2026. They explain why things are the way
  they are, but a record can describe something a later round changed. When a
  record and a reference chapter disagree, the chapter is current.

## Reference chapters

1. [System overview and architecture](01-system-overview-and-architecture.md)
2. [Setup and local development](02-setup-and-local-development.md)
3. [Frontend and API](03-frontend-and-api-architecture.md)
4. [Analysis graph and nodes](04-python-graphs-and-nodes.md)
5. [Worker, queue and analysis pipeline](05-worker-queue-and-analysis-pipeline.md)
6. [Data model and schema](06-data-model-and-schema.md)
7. [Testing and quality](07-testing-and-quality.md)
8. [Deployment and operations runbook](08-deployment-and-operations-runbook.md)
9. [Module catalog](09-module-catalog.md)

Suggested order for a new reader: 01, 02, 03, then 04 and 05 for the analysis,
06 for the data, and 08 before deploying anything.

## Round records

### The move to Google Cloud

The project first ran on Supabase (database, storage, sign-in) and Vercel
(hosting). These records cover the move to Cloud SQL, Cloud Storage, Cloud Run,
Cloud Tasks and Firebase.

| Record | Subject |
| --- | --- |
| [10](10-google-cloud-migration.md) | Migration plan |
| [12](12-google-cloud-phase-3.md) | Phase 3 |
| [13](13-full-google-cloud-roadmap.md) | Full roadmap |
| [14](14-firebase-auth-parity.md) | Firebase sign-in parity check |
| [15](15-google-cloud-phase-5.md) | Phase 5: staging web and API service |
| [16](16-google-cloud-phase-6.md) | Phase 6: Cloud SQL dual writes and shadow checks |
| [17](17-google-cloud-phase-7.md) | Phase 7: frontend hosting |
| [18](18-google-cloud-phase-8.md) | Phase 8: final data and service cutover |
| [19](19-google-cloud-phase-8d-8e-runbook.md) | Phase 8D and 8E production runbook |
| [20](20-project-conversation-and-migration-summary.md) | Project and migration summary |
| [22](22-firebase-production-hostname.md) | Firebase production hostname |
| [23](23-project-handoff-2026-09-20.md) | Full project handoff, 2026-09-20 |

### Security and cost

| Record | Subject |
| --- | --- |
| [11](11-security-cost-hardening.md) | Security and cost hardening |
| [26](26-cost-reduction.md) | Cost reduction |

### Analysis pipeline

| Record | Subject |
| --- | --- |
| [12](12-pipeline-speed-efficiency-evaluation.md) | Pipeline speed and efficiency evaluation |
| [29](29-pipeline-enhancement.md) | Pipeline enhancement |

### Product, dashboard and interface

| Record | Subject |
| --- | --- |
| [11](11-ux-efficiency-accuracy-speed-improvements.md) | UX, accuracy and speed plan |
| [17](17-chula-wide-generalization-plan.md) | Making Papertrend work beyond EIL |
| [18](18-repository-semantic-map.md) | Repository Semantic Map |
| [21](21-repository-taxonomy-v2.md) | Repository taxonomy and custom research areas |
| [24](24-professor-feedback-round-1.md) | Professor's feedback, round 1 |
| [27](27-site-ui-quality-audit.md) | Site-wide interface audit, and the brand rules |
| [28](28-dashboard-enhancement-plan.md) | Dashboard enhancement |
| [30](30-adaptive-insights-plan.md) | Adaptive tab |
| [32](32-site-audit-fixes-plan.md) | Fixes from the whole-site audit |
| [40](40-professor-feedback-round.md) | Professor's feedback, round 2 |
| [44](44-ui-audit-2026-10-31.md) | Interface audit batch, 2026-10-31 |

### Chat, Chart mode and the Table

| Record | Subject |
| --- | --- |
| [20](20-agentic-chat-and-deep-research-study.md) | Study of agentic chat and deep research |
| [25](25-chat-page-improvement-plan.md) | Chat page improvements |
| [31](31-deep-research-and-chat-tools-plan.md) | Deep research, Chart mode and web search |
| [33](33-chat-architecture.md) | How the chat works |
| [34](34-model-choice.md) | Model choice for chat and deep research |
| [35](35-chat-reading-charts-citations.md) | Whole-paper reading, charts and passage citations |
| [36](36-chat-cost-speed-question-bank.md) | Cheaper, faster High and Max, and the question bank |
| [38](38-charts-for-any-collection.md) | Charts for any size of collection |
| [39](39-second-chat-model.md) | A second chat model (withdrawn on 2026-10-24) |
| [41](41-chat-chart-gaps-round.md) | Chat and Chart mode gaps |
| [42](42-paper-table.md) | The paper Table |

### The product film

| Record | Subject |
| --- | --- |
| [43](43-home-film.md) | The film on the home page |

## Secrets

Never commit secret values. Environment files that hold them are git-ignored,
and the deployed services read theirs from Secret Manager. If a secret is ever
committed or pasted somewhere public, rotate it in its provider and replace it
in Secret Manager.
