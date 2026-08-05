# Papertrend Agentic Chat And Deep Research Study

Date: 2026-08-06

## Scope And Method

This study reviewed the public documentation, architecture descriptions, and representative implementation guidance of every unique repository supplied for this work. Duplicate entries for STORM and Local Deep Research were reviewed once. It is not a claim that every historical commit and every line in these very large repositories was read; that would add little engineering confidence. The review targets the parts that determine system behavior: orchestration, retrieval, memory, prompting, grounding, citations, security, evaluation, and deployment.

The leaked-system-prompt collection was treated as a pattern catalog only. Papertrend does not copy proprietary prompts. Its prompt contract is original, auditable, versioned, and specific to authorized research repositories.

## Repository Findings

| Repository | Useful pattern | Papertrend decision |
| --- | --- | --- |
| system_prompts_leaks | Explicit role, tool, safety, formatting, and failure contracts | Adopt the structure, not leaked text |
| chatgpt-custom-knowledge-chatbot | Simple conversational RAG baseline | Keep only as a baseline comparison |
| Pathway llm-app | Live indexing, incremental updates, hybrid indexes, cache | Adopt event-driven repository memory updates |
| Flowise | Graph/state/tool/loop orchestration, checkpoints, HITL | Keep typed graph steps and observable tool traces |
| WeKnora | ReAct, scoped sources, Wiki memory, citations drawer, RBAC, audit | Adopt scoped retrieval, repository digests, source UX, and hard isolation |
| ai-pdf-chatbot-langchain | Streaming PDF RAG reference flow | Already exceeded by Papertrend's structured extraction |
| gpt4free | Provider adapters and compatible API surface | Reject as a production provider dependency due to reliability, credential, and terms risk |
| nanobot | Small readable agent core, tool routing, memory, delegation | Prefer a compact typed core over agent proliferation |
| Chatbox | Multi-provider conversation UX and local-first configuration | Adopt clear model/runtime UX only where useful |
| Quivr | Knowledge containers and workflow-oriented RAG | Papertrend projects/folders remain the knowledge boundary |
| AstrBot | Context compression, skills, MCP, sandboxing | Adopt compression; require a sandbox before any code tool |
| Langchain-Chatchat | Offline/private RAG and replaceable model/vector layers | Preserve provider abstraction and lexical fallback |
| RAGFlow | Deep document parsing, hybrid retrieval, citations, agentic workflows | Adopt layout-aware evidence and retrieval observability incrementally |
| LightRAG | Entity/relationship graph plus local/global retrieval | Evaluate graph retrieval for cross-paper concept synthesis, not basic QA |
| STORM / Co-STORM | Perspective-guided questions, outline-before-writing, modular research/writing | Adopt perspective planning and evidence-first outlines for deep research |
| RAG_Techniques | Query rewriting, HyDE, fusion, reranking, compression, corrective/self RAG, evaluation | Select techniques by measured eval gains, not feature count |
| Haystack | Typed components, routers, loops, async pipelines, evaluation | Matches Papertrend's typed capability and fallback direction |
| Memvid | Portable indexed memory artifact | Not needed while Cloud SQL is the authoritative multi-user store |
| llmware | Library abstraction, hybrid/metadata query, batched source prompts, evidence checking | Adopt batching and post-answer evidence checks |
| txtai | Semantic workflows, graphs, SQL-style search | Useful reference; pgvector avoids another database |
| LEANN | Storage-efficient recomputation-based vector index | Revisit only when vector storage becomes a measured cost problem |
| Microsoft AI Agents for Beginners | Design patterns for tools, planning, multi-agent, memory, metacognition, context engineering | Use as maintainable pattern guidance and training material |
| Ruflo | Harness, memory, budgets, telemetry, security and coordinated tools | Adopt budgets/telemetry; avoid unnecessary swarms |
| Local Deep Research | Iterative search, configurable local/private sources, report synthesis | Adopt bounded iterative exploration and source independence |
| DeerFlow | Planner-led research, subagents, skills, memory, sandbox, long-running workflows | Strong model for durable deep-research jobs and progress traces |
| last30days-skill | Time-bounded source discovery and explicit recency | Add recency constraints only when the user asks for current context |
| Alibaba DeepResearch | Trained tool-using research behavior and benchmark evaluation | Adopt evaluation discipline, not model-specific thought tags |
| DeepSearcher | Private-data-first retrieval, query decomposition, reflection, pluggable loaders/embeddings | Closest match to Papertrend's internal-first hybrid research direction |

## Main Conclusion

A system prompt is necessary but not sufficient. Production quality comes from enforcing the same contract across an execution pipeline:

1. Resolve conversation language and authorized scope.
2. Let an LLM director select a typed capability, with schema validation and a scope-preserving fallback.
3. Use deterministic tools for exact operations and hybrid retrieval for semantic evidence.
4. Rerank by relevance, evidence strength, diversity, and coverage.
5. Expand retrieval when evidence is insufficient.
6. Synthesize from compressed evidence, not raw repository dumps.
7. Audit claims and citations against the evidence ledger.
8. Return useful partial work with explicit limitations when a provider fails.
9. Record prompt version, tools, coverage, latency, token cost, and eval results.

## Implemented In This Change

- Added a versioned Papertrend prompt constitution in `src/lib/papertrend-system-prompt.ts`.
- Added task overlays for request direction, evidence reranking, grounded answers, faithfulness audits, corpus mapping, corpus synthesis, and chart planning.
- Applied the contract to both Repository Chat V1/V2 planning, reranking, answer synthesis, citation repair, exhaustive map-reduce, and chart tool selection.
- Added tests for scope completeness, prompt-injection boundaries, owner isolation, title-first answers, language continuity, citations, and task composition.

## Deliberate Non-Changes

- No copied Claude, Gemini, ChatGPT, or other leaked vendor prompt.
- No migration to a second vector database; Cloud SQL and pgvector remain sufficient.
- No arbitrary code execution tool without a sandbox and explicit policy.
- No multi-agent swarm for ordinary chat. Specialized agents are justified only for deep research jobs where parallel evidence collection has measurable value.
- No universal HyDE step. Hypothetical answers can improve recall but can also bias scientific retrieval; it should be evaluated and enabled selectively.

## Next Evaluation Gate

Measure planner accuracy, exhaustive-scope coverage, retrieval recall, citation validity, claim faithfulness, Thai/English continuity, latency, and cost on a fixed golden set. New RAG techniques should ship only when they improve those scores without weakening owner/project/folder isolation.

