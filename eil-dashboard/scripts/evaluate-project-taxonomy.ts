import { readFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createEilAnalysisProfile, sanitizeProjectAnalysisProfile } from "../src/lib/project-analysis-profile";
import { classifyPaper } from "../src/lib/project-reclassification-service";
import type { ReclassificationPaper } from "../src/lib/project-reclassification-repository";
import type { ProjectAnalysisProfile } from "../src/types/workspace";

loadEnvConfig(process.cwd());

type EvalCase = Omit<ReclassificationPaper, "itemId" | "paperId" | "runId" | "folderId" | "year"> & {
  id: string;
  profile: string;
  expectedPrimary: string;
  year?: string;
};

interface Fixture {
  version: string;
  profiles: Record<string, unknown>;
  cases: EvalCase[];
}

function usageNumber(usage: unknown, ...keys: string[]): number {
  if (!usage || typeof usage !== "object") return 0;
  const row = usage as Record<string, unknown>;
  for (const key of keys) {
    const value = Number(row[key] ?? 0);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function macroF1(expected: string[], actual: string[]): number {
  const labels = [...new Set([...expected, ...actual])];
  if (!labels.length) return 0;
  return labels.reduce((total, label) => {
    let tp = 0;
    let fp = 0;
    let fn = 0;
    expected.forEach((value, index) => {
      if (actual[index] === label && value === label) tp += 1;
      else if (actual[index] === label) fp += 1;
      else if (value === label) fn += 1;
    });
    const precision = tp / Math.max(1, tp + fp);
    const recall = tp / Math.max(1, tp + fn);
    return total + (precision + recall ? (2 * precision * recall) / (precision + recall) : 0);
  }, 0) / labels.length;
}

function loadFixture(): Fixture {
  return JSON.parse(readFileSync(new URL("../evals/project-taxonomy-v2.json", import.meta.url), "utf8")) as Fixture;
}

function profiles(fixture: Fixture): Map<string, ProjectAnalysisProfile> {
  const output = new Map<string, ProjectAnalysisProfile>([["eil", createEilAnalysisProfile()]]);
  Object.entries(fixture.profiles).forEach(([key, value]) => output.set(key, sanitizeProjectAnalysisProfile(value)));
  return output;
}

async function main() {
  const fixture = loadFixture();
  const configuredProfiles = profiles(fixture);
  for (const testCase of fixture.cases) {
    const profile = configuredProfiles.get(testCase.profile);
    if (!profile) throw new Error(`${testCase.id} references an unknown profile.`);
    if (![...profile.categories.map((category) => category.key), "other"].includes(testCase.expectedPrimary)) {
      throw new Error(`${testCase.id} has an invalid expert label.`);
    }
  }
  if (process.argv.includes("--validate-only")) {
    process.stdout.write(`${JSON.stringify({ ok: true, version: fixture.version, cases: fixture.cases.length, profiles: configuredProfiles.size }, null, 2)}\n`);
    return;
  }

  const expected: string[] = [];
  const actual: string[] = [];
  const disagreements: Array<Record<string, unknown>> = [];
  let invalidKeys = 0;
  let failures = 0;
  let promptTokens = 0;
  let completionTokens = 0;
  let reportedCostUsd = 0;
  let totalLatencyMs = 0;

  for (const testCase of fixture.cases) {
    const profile = configuredProfiles.get(testCase.profile)!;
    const paper: ReclassificationPaper = {
      itemId: testCase.id,
      paperId: testCase.id,
      runId: null,
      folderId: null,
      title: testCase.title,
      year: testCase.year ?? "Unknown",
      abstractClaims: testCase.abstractClaims,
      methods: testCase.methods,
      results: testCase.results,
      conclusion: testCase.conclusion,
      concepts: testCase.concepts,
    };
    const started = Date.now();
    try {
      const classified = await classifyPaper(paper, profile);
      totalLatencyMs += Date.now() - started;
      expected.push(testCase.expectedPrimary);
      actual.push(classified.result.primaryCategoryKey);
      const allowed = new Set([...profile.categories.map((category) => category.key), "other"]);
      if (!allowed.has(classified.result.primaryCategoryKey)) invalidKeys += 1;
      promptTokens += usageNumber(classified.usage, "prompt_tokens", "input_tokens");
      completionTokens += usageNumber(classified.usage, "completion_tokens", "output_tokens");
      reportedCostUsd += usageNumber(classified.usage, "cost");
      if (classified.result.primaryCategoryKey !== testCase.expectedPrimary) {
        disagreements.push({
          id: testCase.id,
          profile: testCase.profile,
          expected: testCase.expectedPrimary,
          actual: classified.result.primaryCategoryKey,
          rationale: classified.result.rationale,
        });
      }
    } catch (error) {
      totalLatencyMs += Date.now() - started;
      failures += 1;
      expected.push(testCase.expectedPrimary);
      actual.push("__failure__");
      disagreements.push({ id: testCase.id, expected: testCase.expectedPrimary, actual: "provider_failure", error: error instanceof Error ? error.message : String(error) });
    }
  }

  const correct = actual.filter((value, index) => value === expected[index]).length;
  const otherTp = actual.filter((value, index) => value === "other" && expected[index] === "other").length;
  const otherPredicted = actual.filter((value) => value === "other").length;
  const otherExpected = expected.filter((value) => value === "other").length;
  const report = {
    ok: failures === 0 && invalidKeys === 0,
    version: fixture.version,
    cases: fixture.cases.length,
    primaryAccuracy: correct / fixture.cases.length,
    macroF1: macroF1(expected, actual),
    invalidKeyRate: invalidKeys / fixture.cases.length,
    otherPrecision: otherTp / Math.max(1, otherPredicted),
    otherRecall: otherTp / Math.max(1, otherExpected),
    failures,
    averageLatencyMs: totalLatencyMs / fixture.cases.length,
    promptTokens,
    completionTokens,
    reportedCostUsd,
    disagreements,
    expertReviewRequired: disagreements.length > 0,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) })}\n`);
  process.exitCode = 1;
});
