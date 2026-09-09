import type {
  AnalysisProfileMode,
  ProjectAnalysisProfile,
  WorkspaceAnalysisCategory,
  WorkspaceProfile,
} from "@/types/workspace";

export const PROJECT_ANALYSIS_PROFILE_VERSION = 2 as const;
export const MIN_CUSTOM_CATEGORIES = 2;
export const MAX_CUSTOM_CATEGORIES = 12;

const EIL_CATEGORIES: WorkspaceAnalysisCategory[] = [
  {
    key: "el",
    label: "English Linguistics",
    description:
      "Research primarily explaining English language structure, meaning, variation, discourse, translation, or language use in global and local contexts.",
  },
  {
    key: "eli",
    label: "English Language Instruction",
    description:
      "Research primarily concerning English teaching, learning, pedagogy, curriculum, teacher development, classroom practice, or instructional interventions.",
  },
  {
    key: "lae",
    label: "Language Assessment & Evaluation",
    description:
      "Research primarily concerning language-test design, validation, scoring, measurement, interpretation, washback, or assessment practice.",
  },
];

export const EIL_TAXONOMY_DEFINITION =
  "Classify by the paper's primary contribution. Instructional interventions belong to ELI even when tests measure outcomes. Linguistic analysis belongs to EL unless it primarily builds or validates an assessment, which belongs to LAE. Add secondary categories only for genuine contributions.";

function cleanText(value: unknown, limit: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function cleanCategoryKey(value: unknown, fallback: string): string {
  return (
    cleanText(value, 80)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || fallback
  );
}

function normalizeCategories(input: unknown): WorkspaceAnalysisCategory[] {
  const rows = Array.isArray(input) ? input : [];
  if (rows.length > MAX_CUSTOM_CATEGORIES) {
    throw new Error(`A custom taxonomy supports at most ${MAX_CUSTOM_CATEGORIES} categories.`);
  }
  const seenKeys = new Set<string>();
  const seenLabels = new Set<string>();
  return rows.map((item, index) => {
    const row = item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : {};
    const label = cleanText(row.label, 80);
    const key = cleanCategoryKey(row.key || label, `category_${index + 1}`);
    const normalizedLabel = label.toLocaleLowerCase();
    if (!label) throw new Error(`Category ${index + 1} needs a name.`);
    if (!cleanText(row.description, 600)) {
      throw new Error(`${label} needs a description so papers can be classified reliably.`);
    }
    if (key === "other") throw new Error("Other / Unclassified is added automatically.");
    if (seenKeys.has(key) || seenLabels.has(normalizedLabel)) {
      throw new Error(`Category names must be unique. Duplicate: ${label}.`);
    }
    seenKeys.add(key);
    seenLabels.add(normalizedLabel);
    return { key, label, description: cleanText(row.description, 600) };
  });
}

function hashPayload(payload: Omit<ProjectAnalysisProfile, "profileHash">): string {
  const value = JSON.stringify(payload);
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

function finalize(
  payload: Omit<ProjectAnalysisProfile, "profileHash">
): ProjectAnalysisProfile {
  return { ...payload, profileHash: hashPayload(payload) };
}

export function createGeneralAnalysisProfile(): ProjectAnalysisProfile {
  return finalize({
    version: PROJECT_ANALYSIS_PROFILE_VERSION,
    mode: "general",
    displayName: "General Research",
    domain: "General academic research",
    domainDefinition: "",
    taxonomyName: "No category classification",
    taxonomyDefinition: "",
    additionalContext: "",
    classificationEnabled: false,
    categories: [],
  });
}

export function createEilAnalysisProfile(): ProjectAnalysisProfile {
  return finalize({
    version: PROJECT_ANALYSIS_PROFILE_VERSION,
    mode: "eil",
    displayName: "EIL Tracks",
    domain: "English as an International Language",
    domainDefinition:
      "Research on English in global, multilingual, educational, cultural, assessment, and policy contexts.",
    taxonomyName: "EIL Tracks",
    taxonomyDefinition: EIL_TAXONOMY_DEFINITION,
    additionalContext: "Use the official EIL track boundaries and preserve uncertainty.",
    classificationEnabled: true,
    categories: EIL_CATEGORIES.map((category) => ({ ...category })),
  });
}

export function sanitizeProjectAnalysisProfile(input: unknown): ProjectAnalysisProfile {
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? input as Record<string, unknown>
    : {};
  if (raw.mode !== undefined && !(["general", "eil", "custom"] as unknown[]).includes(raw.mode)) {
    throw new Error("Analysis profile mode must be General Research, EIL Tracks, or Custom Taxonomy.");
  }
  const mode = (["general", "eil", "custom"] as AnalysisProfileMode[]).includes(raw.mode as AnalysisProfileMode)
    ? raw.mode as AnalysisProfileMode
    : "general";
  if (mode === "general") return createGeneralAnalysisProfile();
  if (mode === "eil") return createEilAnalysisProfile();

  const categories = normalizeCategories(raw.categories);
  if (categories.length < MIN_CUSTOM_CATEGORIES) {
    throw new Error(`A custom taxonomy needs at least ${MIN_CUSTOM_CATEGORIES} categories.`);
  }
  return finalize({
    version: PROJECT_ANALYSIS_PROFILE_VERSION,
    mode: "custom",
    displayName: cleanText(raw.displayName, 120) || "Custom Taxonomy",
    domain: cleanText(raw.domain, 160) || "General academic research",
    domainDefinition: cleanText(raw.domainDefinition ?? raw.domain_definition, 1200),
    taxonomyName: cleanText(raw.taxonomyName ?? raw.taxonomy_name, 120) || "Custom Taxonomy",
    taxonomyDefinition: cleanText(raw.taxonomyDefinition ?? raw.taxonomy_definition, 1200),
    additionalContext: cleanText(raw.additionalContext ?? raw.additional_context, 2000),
    classificationEnabled: true,
    categories,
  });
}

export function projectProfileFromLegacyWorkspace(profile: Partial<WorkspaceProfile> | null | undefined) {
  const sourceProfile = profile ?? {};
  const legacyCategories = (sourceProfile.analysisCategories ?? [])
    .filter((category) => String(category.label ?? "").trim())
    .slice(0, MAX_CUSTOM_CATEGORIES)
    .map((category) => ({
      ...category,
      description: cleanText(category.description, 600)
        || `Papers whose primary contribution fits ${cleanText(category.label, 80)}.`,
    }));
  if (legacyCategories.length === 0) {
    return createGeneralAnalysisProfile();
  }
  const legacyKeys = legacyCategories
    .map((category) => cleanCategoryKey(category.key || category.label, ""))
    .filter(Boolean)
    .sort();
  if (legacyKeys.join(",") === "el,eli,lae") {
    return createEilAnalysisProfile();
  }
  if (legacyCategories.length < MIN_CUSTOM_CATEGORIES) {
    return createGeneralAnalysisProfile();
  }
  return sanitizeProjectAnalysisProfile({
    mode: "custom",
    displayName: sourceProfile.categoryTaxonomyName || "Custom Taxonomy",
    domain: sourceProfile.domain,
    domainDefinition: sourceProfile.domainDefinition,
    taxonomyName: sourceProfile.categoryTaxonomyName,
    taxonomyDefinition: sourceProfile.categoryTaxonomyDefinition,
    additionalContext: sourceProfile.analysisContext,
    categories: legacyCategories,
  });
}

/**
 * Stored rows can predate the repository-profile contract. A malformed legacy
 * profile must not make its repository disappear from the product.
 */
export function normalizeStoredProjectAnalysisProfile(input: unknown): ProjectAnalysisProfile {
  try {
    return sanitizeProjectAnalysisProfile(input);
  } catch {
    const raw = input && typeof input === "object" && !Array.isArray(input)
      ? input as Record<string, unknown>
      : {};
    return projectProfileFromLegacyWorkspace({
      domain: cleanText(raw.domain, 160),
      domainDefinition: cleanText(raw.domainDefinition ?? raw.domain_definition, 1200),
      categoryTaxonomyName: cleanText(
        raw.taxonomyName ?? raw.taxonomy_name ?? raw.displayName,
        120
      ),
      categoryTaxonomyDefinition: cleanText(
        raw.taxonomyDefinition ?? raw.taxonomy_definition,
        1200
      ),
      analysisContext: cleanText(
        raw.additionalContext ?? raw.additional_context,
        2000
      ),
      analysisCategories: Array.isArray(raw.categories)
        ? raw.categories as WorkspaceAnalysisCategory[]
        : [],
    });
  }
}

export function toIngestionAnalysisProfile(profile: ProjectAnalysisProfile) {
  return {
    version: 2,
    mode: profile.mode,
    profileVersion: profile.version,
    profileHash: profile.profileHash,
    displayName: profile.displayName,
    domain: profile.domain,
    domainDefinition: profile.domainDefinition,
    taxonomyName: profile.taxonomyName,
    taxonomyDefinition: profile.taxonomyDefinition,
    additionalContext: profile.additionalContext,
    classificationEnabled: profile.classificationEnabled,
    categories: profile.categories,
  };
}
