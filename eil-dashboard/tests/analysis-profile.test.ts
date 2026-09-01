import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnalysisProfileSnapshot,
  sanitizeAnalysisProfilePayload,
} from "../src/lib/analysis-profile";
import {
  DEFAULT_WORKSPACE_PROFILE,
  createWorkspaceAnalysisCategoryDraft,
  normalizeWorkspaceAnalysisCategoryDrafts,
} from "../src/lib/workspace-profile";
import type { WorkspaceProfile } from "../src/types/workspace";

test("user-entered taxonomy name and categories are sent in the analysis profile snapshot", () => {
  const profile: WorkspaceProfile = {
    ...DEFAULT_WORKSPACE_PROFILE,
    domain: "Public health research",
    domainDefinition:
      "Research about population health, clinical service delivery, health systems, and health policy.",
    categoryTaxonomyName: "Study design categories",
    categoryTaxonomyDefinition:
      "Classify papers by primary research design and contribution, not topic keywords alone.",
    analysisContext: "Classify by the paper's primary research design.",
    analysisCategories: normalizeWorkspaceAnalysisCategoryDrafts([
      {
        key: "clinical-trial",
        label: "Clinical Trial",
        description: "Interventional human studies with treatment outcomes.",
      },
      {
        key: "policy-analysis",
        label: "Policy Analysis",
        description: "Studies focused on institutional policy, governance, or regulation.",
      },
    ]),
  };

  const snapshot = buildAnalysisProfileSnapshot(profile);

  assert.equal(snapshot.domain, "Public health research");
  assert.equal(
    snapshot.domainDefinition,
    "Research about population health, clinical service delivery, health systems, and health policy."
  );
  assert.equal(snapshot.taxonomyName, "Study design categories");
  assert.equal(
    snapshot.taxonomyDefinition,
    "Classify papers by primary research design and contribution, not topic keywords alone."
  );
  assert.equal(
    snapshot.additionalContext,
    "Classify by the paper's primary research design."
  );
  assert.deepEqual(
    snapshot.categories.map((category) => ({
      key: category.key,
      label: category.label,
    })),
    [
      { key: "clinical_trial", label: "Clinical Trial" },
      { key: "policy_analysis", label: "Policy Analysis" },
    ]
  );
});

test("blank category rows remain editable drafts but are omitted from queued analysis", () => {
  const draftCategories = normalizeWorkspaceAnalysisCategoryDrafts([
    {
      key: "survey-study",
      label: "Survey Study",
      description: "Questionnaire-based observational research.",
    },
    createWorkspaceAnalysisCategoryDraft(1),
  ]);
  const profile: WorkspaceProfile = {
    ...DEFAULT_WORKSPACE_PROFILE,
    analysisCategories: draftCategories,
  };

  assert.equal(draftCategories.length, 2);
  assert.equal(draftCategories[1].label, "");

  const snapshot = buildAnalysisProfileSnapshot(profile);
  assert.equal(snapshot.categories.length, 1);
  assert.equal(snapshot.categories[0].label, "Survey Study");
});

test("queued API payload sanitization preserves dynamic user categories", () => {
  const sanitized = sanitizeAnalysisProfilePayload({
    domain: "Engineering education",
    domainDefinition: "Research about teaching and learning in engineering contexts.",
    taxonomyName: "Evidence type",
    taxonomyDefinition: "Classify by the evidence design used as the paper's main contribution.",
    additionalContext: "Use the user's taxonomy, not a field-specific default.",
    categories: [
      { key: "experiment", label: "Experiment", description: "Controlled comparison." },
      { key: "case-study", label: "Case Study", description: "Detailed situated inquiry." },
      { key: "review", label: "Review", description: "Synthesis of existing work." },
      { key: "extra", label: "Extra", description: "Should not fit legacy storage." },
    ],
  });

  assert.equal(sanitized.domain, "Engineering education");
  assert.equal(sanitized.domainDefinition, "Research about teaching and learning in engineering contexts.");
  assert.equal(sanitized.taxonomyName, "Evidence type");
  assert.equal(
    sanitized.taxonomyDefinition,
    "Classify by the evidence design used as the paper's main contribution."
  );
  assert.deepEqual(
    sanitized.categories.map((category) => [category.key, category.label]),
    [
      ["experiment", "Experiment"],
      ["case_study", "Case Study"],
      ["review", "Review"],
      ["extra", "Extra"],
    ]
  );
});
