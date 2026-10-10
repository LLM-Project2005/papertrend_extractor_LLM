/*
 * Runs a Max effort answer (the research engine): read each chosen paper,
 * search the web where the plan asked, write the answer, check it, and save
 * it to the conversation.
 *
 * Each step's result is saved before the next begins, so a run interrupted by
 * a restart resumes where it stopped: a paper already read is not read again.
 * The run holds a lease (store.ts) while it works and gives it up when it
 * fails, so a retry can take it at once.
 */
import type { AiTokenUsageTotals } from "@/lib/ai-token-usage";
import { spendUsd } from "@/lib/answer-cost";
import { createChatCompletionResult } from "@/lib/openai";
import { loadRepositoryContext, type RepositoryContext } from "@/lib/repository-chat";
import type { KnowledgeScope } from "@/lib/knowledge-scope";
import type { DeepResearchStepRecord } from "@/types/research";
import { finalizeReport } from "@/lib/deep-research/finalize";
import { callTool } from "@/lib/deep-research/model";
import { dedupeStudies, studyOf, type StudyPaper } from "@/lib/deep-research/plan";
import { checkRecord, readingText, readMessages, readSummary, readTool } from "@/lib/deep-research/read";
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
import { isCurrentEngine, LIMITS, type PaperRecord, type ResearchPlan, type SelectedPaper, type WebSearch } from "@/lib/deep-research/types";
import { checkAnswer } from "@/lib/deep-research/verify";
import { searchWeb } from "@/lib/deep-research/web";
import { answerWords, buildEvidence, condenseMessages, reportMessages, wordLimit, type WebPageRead } from "@/lib/deep-research/write";

export type RunOutcome = "completed" | "skipped" | "canceled" | "retry" | "failed";

export const EARLIER_ENGINE_MESSAGE = "This answer was planned by an earlier version of Max. Ask the question again to plan it afresh.";

function isThai(language: string): boolean {
  return /thai|ไทย/i.test(language);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------- read */

/** Reads one paper for the question; null when the model gives nothing usable. */
export async function readPaper(input: { question: string; plan: Pick<ResearchPlan, "aspects" | "searchTerms">; paper: StudyPaper; whole: boolean }): Promise<PaperRecord | null> {
  const reading = readingText(input.paper, input.whole, [input.question, ...input.plan.searchTerms, ...input.plan.aspects]);
  const raw = await callTool(
    readMessages({ question: input.question, aspects: input.plan.aspects, paper: input.paper, reading }),
    readTool(),
    "DEEP_RESEARCH_READ",
    { maxTokens: 9_000, timeoutMs: 150_000, reasoningEffort: "medium" }
  );
  if (!raw) return null;
  return checkRecord(raw, input.paper, reading.whole);
}

/** Runs `work` on each item, `size` at a time. */
async function inWaves<T>(items: T[], size: number, work: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += size) await Promise.all(items.slice(start, start + size).map(work));
}

/* ------------------------------------------------------------------ the run */

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

/** Writes the answer from what was read; the draft and the evidence it cites. */
export async function writeAnswer(input: {
  question: string;
  plan: ResearchPlan;
  records: PaperRecord[];
  pages: WebPageRead[];
  unread: Array<{ title: string; year: string }>;
  scopeLabel: string;
  studiesInScope: number;
  pendingPapers: number;
  model?: string;
}) {
  const evidence = buildEvidence(input.records, input.pages);
  const completion = await createChatCompletionResult(
    reportMessages({ ...input, evidence, today: today() }),
    0.3,
    input.model,
    "DEEP_RESEARCH_REPORT",
    // GPT-6 Luna's reasoning counts against max_tokens: high reasoning needs room.
    { maxTokens: 16_000, timeoutMs: 240_000, reasoningEffort: "high" }
  );
  const draft = completion?.content?.trim() ?? "";
  return { draft: await condensed(draft, input.plan), evidence };
}

/** The draft, shortened when it runs more than a tenth past its limit (write.ts condenseMessages). */
export async function condensed(draft: string, plan: Pick<ResearchPlan, "breadth" | "language">): Promise<string> {
  const limit = wordLimit(plan);
  if (!draft || answerWords(draft) <= limit * 1.1) return draft;
  try {
    const completion = await createChatCompletionResult(condenseMessages(draft, limit, plan.language), 0.2, undefined, "DEEP_RESEARCH_CONDENSE", {
      maxTokens: 8_000,
      timeoutMs: 120_000,
      reasoningEffort: "low",
    });
    const shorter = completion?.content?.trim() ?? "";
    // A reply that is not shorter, or lost the answer, leaves the draft as it was.
    return shorter && answerWords(shorter) < answerWords(draft) && answerWords(shorter) >= limit * 0.4 ? shorter : draft;
  } catch (error) {
    console.warn("deep_research_condense_failed", { message: error instanceof Error ? error.message : "unknown_error" });
    return draft;
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
    // A run deep research v2 planned (sub-questions and passages) cannot be resumed by this engine.
    if (!isCurrentEngine(session)) {
      await failSession(ownerUserId, sessionId, EARLIER_ENGINE_MESSAGE);
      return "failed";
    }
    const steps = session.steps ?? [];
    const writeStep = stepOf(steps, "dr2_write")[0];
    const checkStep = stepOf(steps, "dr2_check")[0];
    const plan = payload<ResearchPlan>(writeStep, "plan");
    const scope = payload<ResearchScope>(writeStep, "scope");
    const readerQuestion = payload<string>(writeStep, "readerQuestion") ?? session.prompt;
    const model = payload<string | null>(writeStep, "model") ?? undefined;
    if (!writeStep || !checkStep || !plan || !scope) throw new Error("This plan is incomplete. Ask the question again.");
    const thai = isThai(plan.language);

    const context = await contextFor(ownerUserId, scope, readerQuestion);
    const studies = dedupeStudies(context.papers.map(studyOf));
    const byId = new Map(context.papers.map((paper) => [paper.paperId, studyOf(paper)]));

    // 1. Read the chosen papers, a few at once.
    const readSteps = stepOf(steps, "dr2_read");
    await inWaves(
      readSteps.filter((step) => step.status !== "completed"),
      LIMITS.concurrency,
      async (step) => {
        const chosen = payload<SelectedPaper & { whole?: boolean }>(step, "paper");
        const paper = chosen ? byId.get(chosen.paperId) : undefined;
        await saveStep(ownerUserId, step.id, "processing", { summary: thai ? "กำลังอ่าน" : "Reading." });
        const record = paper ? await readPaper({ question: readerQuestion, plan, paper, whole: chosen?.whole !== false }) : null;
        const result = { record, missing: !paper, failed: Boolean(paper) && !record };
        const summary = paper ? readSummary(record, thai) : thai ? "ไม่อยู่ในคลังนี้แล้ว" : "No longer in this repository.";
        await saveStep(ownerUserId, step.id, "completed", { ...result, summary });
        step.status = "completed";
        (step.output_payload as Record<string, unknown>) = result;
      }
    );
    if (!(await stillRunning())) return "canceled";
    const reads = readSteps.map((step) => ({ chosen: payload<SelectedPaper>(step, "paper"), record: output<PaperRecord | null>(step, "record") ?? null, failed: output<boolean>(step, "failed") === true }));
    if (readSteps.length > 0 && reads.every((read) => read.failed)) {
      // Nothing could be read: try again rather than answer from nothing.
      for (const step of readSteps) await saveStep(ownerUserId, step.id, "failed", { summary: thai ? "อ่านไม่ได้ในขณะนี้" : "Could not be read just now." });
      throw new Error("The papers could not be read just now.");
    }

    // 2. The web, only where the plan asked for it.
    const webSteps = stepOf(steps, "dr2_web");
    await Promise.all(
      webSteps
        .filter((step) => step.status !== "completed")
        .map(async (step) => {
          const search = payload<WebSearch>(step, "search");
          if (!search) return;
          await saveStep(ownerUserId, step.id, "processing", { summary: thai ? "กำลังค้นเว็บ" : "Searching the web." });
          const web = await searchWeb(search.query, readerQuestion, today());
          webSearches += 1;
          const summary = web.failed
            ? thai ? "ค้นเว็บไม่สำเร็จ" : "The web search failed; the papers alone are used."
            : thai ? `พบ ${web.pages.length} หน้า` : `Found ${web.pages.length} page${web.pages.length === 1 ? "" : "s"}.`;
          await saveStep(ownerUserId, step.id, "completed", { pages: web.pages, failed: web.failed, summary });
          step.status = "completed";
          (step.output_payload as Record<string, unknown>) = { pages: web.pages };
        })
    );
    if (!(await stillRunning())) return "canceled";
    const pages = webSteps.flatMap((step) => output<WebPageRead[]>(step, "pages") ?? []);
    const records = reads.map((read) => read.record).filter((record): record is PaperRecord => Boolean(record));

    // 3. Write.
    let draft = output<string>(writeStep, "draft");
    let evidence = output<ReturnType<typeof buildEvidence>>(writeStep, "evidence");
    if (!draft || !evidence) {
      await saveStep(ownerUserId, writeStep.id, "processing", { summary: thai ? "กำลังเขียนคำตอบ" : "Writing the answer." });
      const written = await writeAnswer({
        question: readerQuestion,
        plan,
        records,
        pages,
        unread: reads.filter((read) => read.failed && read.chosen).map((read) => ({ title: read.chosen!.title, year: read.chosen!.year })),
        scopeLabel: context.scopeLabel,
        studiesInScope: studies.length,
        pendingPapers: (context.runStats.queued ?? 0) + (context.runStats.processing ?? 0),
        model,
      });
      draft = written.draft;
      evidence = written.evidence;
      if (!draft) throw new Error("The answer could not be written just now.");
      const papers = new Set(evidence.filter((item) => item.kind === "paper").map((item) => item.sourceId)).size;
      await saveStep(ownerUserId, writeStep.id, "completed", {
        draft,
        evidence,
        summary: thai ? `เขียนจากงานวิจัย ${papers} ฉบับ` : `Written from ${papers} paper${papers === 1 ? "" : "s"}.`,
      });
    }
    if (!(await stillRunning())) return "canceled";

    // 4. Check, and save to the conversation.
    await saveStep(ownerUserId, checkStep.id, "processing", { summary: thai ? "กำลังตรวจตัวเลขและการอ้างอิง" : "Checking every number and citation." });
    const relevant = records.filter((record) => record.relevant);
    const checked = await checkAnswer({
      draft,
      evidence,
      language: plan.language,
      counts: [studies.length, context.papers.length, plan.considered ?? records.length, records.length, relevant.length, records.filter((record) => record.whole).length],
      model,
    });
    const final = finalizeReport(checked.report, new Map(evidence.map((item) => [item.id, item])));
    const { audit } = checked;
    await saveStep(ownerUserId, checkStep.id, "completed", {
      audit,
      auditRan: checked.auditRan,
      changes: checked.changes.slice(0, 40),
      summary: thai
        ? `ตรวจ ${audit.checked} ข้อความ: แก้ ${audit.rewritten} นำออก ${audit.removed}`
        : `Checked ${audit.checked} sentence${audit.checked === 1 ? "" : "s"}: ${audit.rewritten} corrected, ${audit.removed} removed.`,
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
        papersSearched: records.length,
        papersRelevant: relevant.length,
        papersWhole: records.filter((record) => record.whole).length,
        evidence: evidence.length,
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
    // The final failure, after the retries; the "research or chat jobs failing" alert counts these.
    console.error("deep_research_session_failed", { sessionId, message: message.slice(0, 300) });
    await failSession(ownerUserId, sessionId, `${message} Retry to continue from where it stopped.`).catch(() => undefined);
    return "failed";
  } finally {
    clearInterval(beat);
  }
}
