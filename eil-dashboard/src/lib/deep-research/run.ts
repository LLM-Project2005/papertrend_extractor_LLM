/*
 * Runs a deep research session (docs/31, phase 3): gather each sub-question,
 * write the report, check it, and save it to the conversation.
 *
 * Each step's result is saved before the next begins, so a run interrupted by
 * a restart resumes where it stopped. The run holds a lease (store.ts) while
 * it works and gives it up when it fails, so a retry can take it at once.
 */
import type { AiTokenUsageTotals } from "@/lib/ai-token-usage";
import { spendUsd } from "@/lib/answer-cost";
import { loadChatInsightCorpus } from "@/lib/chat-chart";
import { buildInsightReport } from "@/lib/insights/engine";
import { createChatCompletionResult } from "@/lib/openai";
import { loadRepositoryContext, type RepositoryContext } from "@/lib/repository-chat";
import type { KnowledgeScope } from "@/lib/knowledge-scope";
import type { DeepResearchStepRecord } from "@/types/research";
import { findingsMessages, findingsTool, labelCandidates, parseFindings, type ParsedFindings } from "@/lib/deep-research/findings";
import { finalizeReport } from "@/lib/deep-research/finalize";
import { callTool } from "@/lib/deep-research/model";
import { buildPassageIndex, searchPassages, type PassageIndex } from "@/lib/deep-research/retrieve";
import {
  claimSession,
  completeSession,
  failSession,
  heartbeat,
  releaseLease,
  saveStep,
  sessionStatus,
  type ResearchScope,
} from "@/lib/deep-research/store";
import { LIMITS, type AuditResult, type Evidence, type GatherResult, type PlannedQuestion, type ResearchPlan } from "@/lib/deep-research/types";
import {
  auditMessages,
  auditTool,
  citesIn,
  codeCheck,
  dropUnknownCitations,
  emptyAudit,
  parseAudit,
  parseReport,
  parseRevisions,
  rebuild,
  reviseMessages,
  reviseTool,
  type ReportUnit,
} from "@/lib/deep-research/verify";
import { searchWeb } from "@/lib/deep-research/web";
import { reportMessages, type ComputedFact } from "@/lib/deep-research/write";

export type RunOutcome = "completed" | "skipped" | "canceled" | "retry" | "failed";

function isThai(language: string): boolean {
  return /thai|ไทย/i.test(language);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ gather */

export async function gatherQuestion(input: {
  question: PlannedQuestion;
  readerQuestion: string;
  index: PassageIndex;
  language: string;
}): Promise<GatherResult> {
  const { question } = input;
  const hits = searchPassages(input.index, [...question.queries, question.question], { limit: LIMITS.candidatesPerQuestion, perPaper: 2 });
  let pages: Array<{ url: string; title: string; text: string }> = [];
  let webFailed = false;
  const webSearched = question.sources !== "papers";
  if (webSearched) {
    const web = await searchWeb(question.queries[0] ?? question.question, question.question, today());
    pages = web.pages;
    webFailed = web.failed;
  }
  // A web-only sub-question still sees the papers' best few passages.
  const passages = question.sources === "web" ? hits.slice(0, 6) : hits;
  const candidates = labelCandidates(passages, pages);
  const base = { questionId: question.id, question: question.question, searchedPapers: input.index.papers, webSearched, webFailed };
  if (candidates.length === 0) {
    return { ...base, evidence: [], findings: [], coverage: "not_found", missing: "No passage in the papers searched matched this sub-question." };
  }
  const raw = await callTool(
    findingsMessages({ readerQuestion: input.readerQuestion, subQuestion: question.question, candidates }),
    findingsTool(),
    "DEEP_RESEARCH_FINDINGS",
    { maxTokens: 1_800, timeoutMs: 75_000, reasoningEffort: "low" }
  );
  const parsed = parseFindings(raw, new Set(candidates.map((candidate) => candidate.label)));
  if (!parsed) {
    return { ...base, evidence: [], findings: [], coverage: "not_found", missing: "The passages for this sub-question could not be read just now." };
  }
  return { ...base, ...evidenceFromFindings(parsed, question.id, passages, pages) };
}

/**
 * Keeps only what a finding cites, in the order it is first cited; a finding
 * whose sources were all cut by the per-question limit goes too.
 */
export function evidenceFromFindings(
  parsed: ParsedFindings,
  questionId: string,
  passages: Array<{ paperId: string; title: string; year: string; section: string; text: string }>,
  pages: Array<{ url: string; title: string; text: string }>
): Pick<GatherResult, "evidence" | "findings" | "coverage" | "missing"> {
  const order: string[] = [];
  for (const finding of parsed.findings) for (const label of finding.labels) if (!order.includes(label)) order.push(label);
  const kept = order
    .filter((label) => (label.startsWith("W") ? pages[Number(label.slice(1)) - 1] : passages[Number(label.slice(1)) - 1]))
    .slice(0, LIMITS.passagesPerQuestion);
  const evidence: Evidence[] = kept.map((label) => {
    const localId = `${questionId}:${label}`;
    if (label.startsWith("W")) {
      const page = pages[Number(label.slice(1)) - 1];
      return { id: localId, kind: "web", sourceId: page.url, url: page.url, title: page.title, year: "Web", text: page.text, questionId };
    }
    const hit = passages[Number(label.slice(1)) - 1];
    return { id: localId, kind: "paper", sourceId: hit.paperId, title: hit.title, year: hit.year, text: hit.text, section: hit.section, questionId };
  });
  const keptSet = new Set(kept);
  const findings = parsed.findings
    .map((finding) => ({ statement: finding.statement, kind: finding.kind, evidenceIds: finding.labels.filter((label) => keptSet.has(label)).map((label) => `${questionId}:${label}`) }))
    .filter((finding) => finding.evidenceIds.length > 0);
  return { evidence, findings, coverage: findings.length ? parsed.coverage : "not_found", missing: parsed.missing };
}

function gatherSummary(result: GatherResult, thai: boolean): string {
  const papers = new Set(result.evidence.filter((item) => item.kind === "paper").map((item) => item.sourceId)).size;
  const pages = result.evidence.filter((item) => item.kind === "web").length;
  if (result.evidence.length === 0) {
    return thai ? `ไม่พบในงานวิจัย ${result.searchedPapers} ฉบับที่ค้น` : `Not found in the ${result.searchedPapers} papers searched.`;
  }
  if (thai) return `พบหลักฐาน ${result.evidence.length} ตอนจากงานวิจัย ${papers} ฉบับ${pages ? ` และหน้าเว็บ ${pages} หน้า` : ""}`;
  return `Found ${result.evidence.length} passage${result.evidence.length === 1 ? "" : "s"} in ${papers} paper${papers === 1 ? "" : "s"}${pages ? ` and ${pages} web page${pages === 1 ? "" : "s"}` : ""}.`;
}

/* --------------------------------------------------------- write and check */

/** Numbers every run's evidence E1, E2... across sub-questions, in plan order. */
export function numberEvidence(gathered: GatherResult[]): { evidence: Evidence[]; results: GatherResult[] } {
  const ids = new Map<string, string>();
  const evidence: Evidence[] = [];
  for (const result of gathered) {
    for (const item of result.evidence) {
      // The same passage found for two sub-questions is one piece of evidence.
      const duplicate = evidence.find((existing) => existing.kind === item.kind && existing.sourceId === item.sourceId && existing.text === item.text);
      if (duplicate) {
        ids.set(item.id, duplicate.id);
        continue;
      }
      const id = `E${evidence.length + 1}`;
      ids.set(item.id, id);
      evidence.push({ ...item, id });
    }
  }
  const results = gathered.map((result) => ({
    ...result,
    evidence: result.evidence.map((item) => ({ ...item, id: ids.get(item.id) ?? item.id })),
    findings: result.findings.map((finding) => ({ ...finding, evidenceIds: [...new Set(finding.evidenceIds.map((id) => ids.get(id) ?? id))] })),
  }));
  return { evidence, results };
}

function wordCount(text: string): number {
  return /[ก-๛]/.test(text) ? Math.round(text.replace(/\s+/g, "").length / 6) : text.split(/\s+/).filter(Boolean).length;
}

/** Holds the report to its evidence: code checks, an independent audit, one revision. */
export async function checkReport(input: {
  draft: string;
  evidence: Evidence[];
  facts: ComputedFact[];
  question: string;
  language: string;
  model?: string;
}): Promise<{ report: string; audit: AuditResult; auditRan: boolean }> {
  const evidence = new Map(input.evidence.map((item) => [item.id, item]));
  const factText = `${input.facts.map((fact) => fact.text).join(" ")} ${input.question}`;
  const parsed = parseReport(input.draft);
  const audit = emptyAudit();
  const replacements = new Map<string, string>();
  const units = parsed.units.filter((unit) => !unit.heading);
  const lastSection = parsed.sections - 1;

  // Ids that do not exist are removed before anything else looks at the text.
  const current = new Map<string, ReportUnit>();
  for (const unit of units) {
    const unknown = unit.cites.filter((id) => !evidence.has(id));
    audit.unknownCitations += unknown.length;
    const text = unknown.length ? dropUnknownCitations(unit.text, evidence) : unit.text;
    if (text !== unit.text) replacements.set(unit.id, text);
    current.set(unit.id, { ...unit, text, cites: citesIn(text) });
  }
  // The opening answer and the closing limits may summarise without citing;
  // a body sentence that states something needs a source.
  const substantive = (unit: ReportUnit) => wordCount(unit.text) >= 8;
  const toAudit = [...current.values()].filter((unit) => unit.cites.length > 0 || (unit.section > 0 && unit.section < lastSection && substantive(unit)));

  let verdicts = new Map<string, import("@/lib/deep-research/verify").Verdict>();
  let auditRan = false;
  if (toAudit.length > 0) {
    const raw = await callTool(auditMessages(toAudit, input.evidence), auditTool(), "DEEP_RESEARCH_AUDIT", { maxTokens: 3_000, timeoutMs: 75_000 });
    if (raw) {
      auditRan = true;
      verdicts = parseAudit(raw, new Set(toAudit.map((unit) => unit.id)));
    }
  }

  const flagged: Array<{ unit: ReportUnit; problem: string; evidenceIds: string[] }> = [];
  for (const unit of toAudit) {
    const verdict = verdicts.get(unit.id);
    const code = codeCheck(unit, evidence, factText);
    if (verdict) audit.checked += 1;
    if (code.badNumbers.length) audit.numberMismatches += 1;
    if (verdict?.verdict === "supported" && unit.cites.length === 0) {
      const sources = verdict.sources.filter((id) => evidence.has(id));
      if (sources.length) {
        // Supported but uncited: the audit named its source, so cite it.
        const cited = unit.text.replace(/([.!?])?$/, (end) => ` [${sources.join(", ")}]${end || "."}`);
        replacements.set(unit.id, cited);
        audit.supported += 1;
        continue;
      }
    }
    const numberProblem = code.badNumbers.length ? `the number${code.badNumbers.length > 1 ? "s" : ""} ${code.badNumbers.join(", ")} ${code.badNumbers.length > 1 ? "are" : "is"} not in its evidence` : "";
    if ((verdict && (verdict.verdict === "partly" || verdict.verdict === "unsupported")) || numberProblem) {
      flagged.push({
        unit,
        problem: [verdict && verdict.verdict !== "supported" ? verdict.problem || `judged ${verdict.verdict}` : "", numberProblem, unit.cites.length === 0 ? "it cites no source" : ""].filter(Boolean).join("; "),
        evidenceIds: [...new Set([...unit.cites, ...(verdict?.sources ?? [])])].filter((id) => evidence.has(id)),
      });
    } else if (verdict && (verdict.verdict === "supported" || verdict.verdict === "no_claim")) {
      audit.supported += 1;
    }
  }

  if (flagged.length > 0) {
    const batch = flagged.slice(0, 30);
    const raw = await callTool(reviseMessages(batch, evidence, input.language), reviseTool(), "DEEP_RESEARCH_REVISE", {
      model: input.model,
      maxTokens: 3_000,
      timeoutMs: 75_000,
      reasoningEffort: "low",
    });
    const revisions = raw ? parseRevisions(raw, new Set(batch.map((item) => item.unit.id))) : new Map<string, string>();
    for (const item of flagged) {
      const revised = revisions.get(item.unit.id);
      const text = revised ? dropUnknownCitations(revised, evidence) : "";
      const cites = citesIn(text);
      const allowed = new Set(item.evidenceIds);
      const check = codeCheck({ text, cites }, evidence, factText);
      // Kept only when it now cites evidence it was given and every number is in it.
      const ok = text && cites.length > 0 && cites.every((id) => allowed.has(id)) && check.badNumbers.length === 0;
      if (ok) {
        replacements.set(item.unit.id, text);
        audit.rewritten += 1;
      } else {
        replacements.set(item.unit.id, "");
        audit.removed += 1;
      }
    }
  }
  return { report: rebuild(parsed, replacements), audit, auditRan };
}

/* ----------------------------------------------------------------- the run */

function stepOf(steps: DeepResearchStepRecord[], tool: string): DeepResearchStepRecord[] {
  return steps.filter((step) => step.tool_name === tool);
}

function payload<T>(step: DeepResearchStepRecord | undefined, key: string): T | undefined {
  return (step?.input_payload as Record<string, unknown> | undefined)?.[key] as T | undefined;
}

function output<T>(step: DeepResearchStepRecord | undefined, key: string): T | undefined {
  return (step?.output_payload as Record<string, unknown> | undefined)?.[key] as T | undefined;
}

async function contextFor(ownerUserId: string, scope: ResearchScope, question: string): Promise<RepositoryContext> {
  const knowledgeScope: KnowledgeScope = {
    kind: scope.kind as KnowledgeScope["kind"],
    ...(scope.projectId ? { projectId: scope.projectId } : {}),
    ...(scope.folderId ? { folderId: scope.folderId } : {}),
    ...(scope.runIds.length ? { runIds: scope.runIds } : {}),
  };
  return loadRepositoryContext({
    ownerUserId,
    projectId: scope.projectId,
    folderId: scope.folderId,
    selectedRunIds: scope.runIds,
    knowledgeScope,
    prompt: question,
  });
}

export function passageIndexFor(context: RepositoryContext): PassageIndex {
  return buildPassageIndex(
    context.papers.map((paper) => ({
      paperId: paper.paperId,
      title: paper.title,
      year: paper.year,
      abstract: paper.abstract,
      methods: paper.methods,
      results: paper.results,
      conclusion: paper.conclusion,
      content: paper.content,
      topics: [...paper.topics.keys()],
      keywords: [...paper.keywords.keys()],
    }))
  );
}

async function computedFacts(ownerUserId: string, context: RepositoryContext): Promise<ComputedFact[]> {
  try {
    const projectIds = context.projectId ? [context.projectId] : context.projects.map((project) => project.id);
    const corpus = await loadChatInsightCorpus(ownerUserId, projectIds, new Set(context.papers.map((paper) => String(paper.paperId))));
    const report = buildInsightReport(corpus);
    const facts: ComputedFact[] = [];
    if (report.summary.papers > 0) {
      facts.push({
        text: `The collection has ${report.summary.papers} distinct analysed papers${report.summary.firstYear ? `, published ${report.summary.firstYear} to ${report.summary.lastYear}` : ""}.`,
      });
    }
    for (const insight of report.insights.slice(0, 4)) facts.push({ text: insight.takeaway });
    return facts;
  } catch (error) {
    console.warn("deep_research_facts_failed", { message: error instanceof Error ? error.message : "unknown_error" });
    return [];
  }
}

export async function runResearchSession(input: {
  ownerUserId: string;
  sessionId: string;
  usage?: AiTokenUsageTotals;
  retryCount?: number;
}): Promise<RunOutcome> {
  const { ownerUserId, sessionId } = input;
  const session = await claimSession(ownerUserId, sessionId);
  if (!session) return "skipped";
  let lost = false;
  const beat = setInterval(() => {
    void heartbeat(ownerUserId, sessionId)
      .then((alive) => {
        if (!alive) lost = true;
      })
      .catch(() => undefined);
  }, 20_000);
  const stillRunning = async () => !lost && (await sessionStatus(ownerUserId, sessionId)) === "processing";
  const startedAt = Date.now();
  let webSearches = 0;
  try {
    const steps = session.steps ?? [];
    const writeStep = stepOf(steps, "dr2_write")[0];
    const checkStep = stepOf(steps, "dr2_check")[0];
    const plan = payload<ResearchPlan>(writeStep, "plan");
    const scope = payload<ResearchScope>(writeStep, "scope");
    const readerQuestion = payload<string>(writeStep, "readerQuestion") ?? session.prompt;
    const model = payload<string | null>(writeStep, "model") ?? undefined;
    if (!writeStep || !checkStep || !plan || !scope) throw new Error("This research plan is incomplete. Plan it again.");
    const thai = isThai(plan.language);

    const context = await contextFor(ownerUserId, scope, readerQuestion);
    const index = passageIndexFor(context);

    // 1. Gather, every unfinished sub-question at once.
    const gatherSteps = stepOf(steps, "dr2_gather");
    await Promise.all(
      gatherSteps
        .filter((step) => step.status !== "completed")
        .map(async (step) => {
          const question = payload<PlannedQuestion>(step, "question");
          if (!question) return;
          await saveStep(ownerUserId, step.id, "processing", {
            summary: thai ? "กำลังค้นในงานวิจัย" + (question.sources !== "papers" ? "และเว็บ" : "") : `Searching the papers${question.sources !== "papers" ? " and the web" : ""}.`,
          });
          const result = await gatherQuestion({ question, readerQuestion, index, language: plan.language });
          if (result.webSearched) webSearches += 1;
          await saveStep(ownerUserId, step.id, "completed", { result, summary: gatherSummary(result, thai) });
          step.status = "completed";
          (step.output_payload as Record<string, unknown>) = { result };
        })
    );
    if (!(await stillRunning())) return "canceled";
    const gathered = gatherSteps.map((step) => output<GatherResult>(step, "result")).filter((result): result is GatherResult => Boolean(result));

    // 2. Write.
    let draft = output<string>(writeStep, "draft");
    let evidence = output<Evidence[]>(writeStep, "evidence");
    let facts = output<ComputedFact[]>(writeStep, "facts") ?? [];
    if (!draft || !evidence) {
      await saveStep(ownerUserId, writeStep.id, "processing", { summary: thai ? "กำลังเขียนรายงาน" : "Writing the report." });
      const numbered = numberEvidence(gathered);
      evidence = numbered.evidence;
      facts = plan.analytics ? await computedFacts(ownerUserId, context) : [];
      const completion = await createChatCompletionResult(
        reportMessages({
          question: readerQuestion,
          plan,
          gathered: numbered.results,
          evidence,
          facts,
          scopeLabel: context.scopeLabel,
          paperCount: context.papers.length,
          pendingPapers: (context.runStats.queued ?? 0) + (context.runStats.processing ?? 0),
          today: today(),
        }),
        0.3,
        model,
        "DEEP_RESEARCH_REPORT",
        { maxTokens: 4_000, timeoutMs: 150_000, reasoningEffort: "low" }
      );
      draft = completion?.content?.trim() ?? "";
      if (!draft) throw new Error("The report could not be written just now.");
      await saveStep(ownerUserId, writeStep.id, "completed", {
        draft,
        evidence,
        facts,
        summary: thai ? `ร่างรายงานโดยอ้างอิงหลักฐาน ${evidence.length} รายการ` : `Drafted, citing ${evidence.length} piece${evidence.length === 1 ? "" : "s"} of evidence.`,
      });
    }
    if (!(await stillRunning())) return "canceled";

    // 3. Check, and save to the conversation.
    await saveStep(ownerUserId, checkStep.id, "processing", { summary: thai ? "กำลังตรวจข้ออ้างกับแหล่งที่มา" : "Checking each claim against its source." });
    const checked = await checkReport({ draft, evidence, facts, question: readerQuestion, language: plan.language, model });
    const final = finalizeReport(checked.report, new Map(evidence.map((item) => [item.id, item])));
    const { audit } = checked;
    await saveStep(ownerUserId, checkStep.id, "completed", {
      audit,
      auditRan: checked.auditRan,
      summary: checked.auditRan
        ? thai
          ? `ตรวจ ${audit.checked} ข้อความ: แก้ ${audit.rewritten} นำออก ${audit.removed}`
          : `Checked ${audit.checked} sentence${audit.checked === 1 ? "" : "s"}: ${audit.rewritten} corrected, ${audit.removed} removed.`
        : thai
          ? "ตรวจตัวเลขและการอ้างอิงแล้ว แต่การตรวจข้ออ้างอัตโนมัติไม่ได้ทำงาน"
          : "Citations and numbers were checked; the automatic claim check could not run.",
    });
    const spend = input.usage ? spendUsd(input.usage, webSearches) : null;
    const saved = await completeSession({
      ownerUserId,
      sessionId,
      report: final.text,
      citations: final.citations,
      metadata: {
        language: plan.language,
        audit,
        auditRan: checked.auditRan,
        questions: gathered.map((result) => ({ id: result.questionId, coverage: result.coverage })),
        evidence: evidence.length,
        papersSearched: index.papers,
        durationMs: Date.now() - startedAt,
        ...(spend ? { spendUsd: spend.usd, spendSource: spend.source } : {}),
      },
    });
    return saved ? "completed" : "canceled";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("deep_research_run_failed", { sessionId, retryCount: input.retryCount ?? 0, message });
    if ((input.retryCount ?? 0) < 2) {
      await releaseLease(ownerUserId, sessionId).catch(() => undefined);
      return "retry";
    }
    await failSession(ownerUserId, sessionId, `${message} Retry to continue from where it stopped.`).catch(() => undefined);
    return "failed";
  } finally {
    clearInterval(beat);
  }
}
