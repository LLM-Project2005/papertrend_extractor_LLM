import assert from "node:assert/strict";
import test from "node:test";
import {
  createEilAnalysisProfile,
  createGeneralAnalysisProfile,
  projectProfileFromLegacyWorkspace,
  sanitizeProjectAnalysisProfile,
  toIngestionAnalysisProfile,
} from "../src/lib/project-analysis-profile";
import { validateClassificationResult } from "../src/lib/project-reclassification-service";
import { DEFAULT_WORKSPACE_PROFILE } from "../src/lib/workspace-profile";

test("General Research is the stable default and disables category classification", () => {
  const first = createGeneralAnalysisProfile();
  const second = createGeneralAnalysisProfile();
  assert.equal(first.mode, "general");
  assert.equal(first.classificationEnabled, false);
  assert.deepEqual(first.categories, []);
  assert.equal(first.profileHash, second.profileHash);
});

test("EIL profile preserves official keys and decisive boundary guidance", () => {
  const profile = createEilAnalysisProfile();
  assert.deepEqual(profile.categories.map((category) => category.key), ["el", "eli", "lae"]);
  assert.match(profile.taxonomyDefinition, /Instructional interventions belong to ELI/);
  assert.match(profile.taxonomyDefinition, /builds or validates an assessment.*LAE/);
});

test("custom profiles require 2 to 12 unique, described categories", () => {
  assert.throws(() => sanitizeProjectAnalysisProfile({ mode: "custom", categories: [{ label: "Only", description: "One category" }] }), /at least 2/);
  assert.throws(() => sanitizeProjectAnalysisProfile({ mode: "custom", categories: [
    { label: "Case study", description: "First" }, { label: "Case study", description: "Second" },
  ] }), /unique/);
  assert.throws(() => sanitizeProjectAnalysisProfile({ mode: "custom", categories: [
    { label: "Other", description: "Reserved" }, { label: "Review", description: "Synthesis" },
  ] }), /automatically/);
  const profile = sanitizeProjectAnalysisProfile({ mode: "custom", taxonomyName: "Methods", categories: [
    { label: "Experiment", description: "Controlled intervention evidence." },
    { label: "Review", description: "Synthesis of prior research." },
    { label: "Case study", description: "Situated in-depth investigation." },
  ] });
  assert.equal(profile.categories.length, 3);
  assert.equal(profile.categories[0].key, "experiment");
});

test("profile snapshots carry immutable mode, version, and hash", () => {
  const profile = createEilAnalysisProfile();
  const snapshot = toIngestionAnalysisProfile(profile);
  assert.equal(snapshot.profileVersion, 2);
  assert.equal(snapshot.profileHash, profile.profileHash);
  assert.equal(snapshot.classificationEnabled, true);
  assert.notEqual(snapshot, profile);
});

test("legacy official EIL keys migrate to the EIL preset instead of an accidental custom taxonomy", () => {
  const profile = projectProfileFromLegacyWorkspace({
    ...DEFAULT_WORKSPACE_PROFILE,
    analysisCategories: [
      { key: "EL", label: "English Linguistics", description: "Language systems" },
      { key: "ELI", label: "English Language Instruction", description: "Teaching" },
      { key: "LAE", label: "Language Assessment", description: "Measurement" },
    ],
  });
  assert.equal(profile.mode, "eil");
});

test("legacy custom profiles receive migration-safe descriptions without inventing categories", () => {
  const migrated = projectProfileFromLegacyWorkspace({
    analysisCategories: [
      { key: "qualitative", label: "Qualitative", description: "" },
      { key: "quantitative", label: "Quantitative", description: "Statistical studies" },
    ],
    categoryTaxonomyName: "Methods",
  });
  assert.equal(migrated.mode, "custom");
  assert.match(migrated.categories[0].description, /primary contribution fits Qualitative/);

  const unusable = projectProfileFromLegacyWorkspace({
    analysisCategories: [{ key: "only", label: "Only category", description: "" }],
  });
  assert.equal(unusable.mode, "general");
});

test("classifier validation rejects invented keys and conservatively limits secondary categories", () => {
  const profile = createEilAnalysisProfile();
  assert.throws(() => validateClassificationResult({ primaryCategoryKey: "invented", rationale: "No." }, profile), /invalid/);
  const result = validateClassificationResult({
    primaryCategoryKey: "eli",
    additionalCategoryKeys: ["lae", "el", "invented", "eli"],
    rationale: "The paper evaluates an instructional intervention and contributes an assessment analysis.",
  }, profile);
  assert.deepEqual(result.additionalCategoryKeys, ["lae", "el"]);
});
