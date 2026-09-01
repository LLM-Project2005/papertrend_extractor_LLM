import type { WorkspaceProfile } from "@/types/workspace";

const LEGACY_CATEGORY_STORAGE_SLOTS = ["EL", "ELI", "LAE"] as const;

export type CategoryStorageSlot = (typeof LEGACY_CATEGORY_STORAGE_SLOTS)[number];

export interface AnalysisProfileCategorySnapshot {
  key: string;
  label: string;
  description: string;
}

export interface AnalysisProfileSnapshot {
  version: 1;
  domain: string;
  domainDefinition: string;
  taxonomyName: string;
  taxonomyDefinition: string;
  additionalContext: string;
  categories: AnalysisProfileCategorySnapshot[];
}

function cleanText(value: unknown, limit: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

export function cleanAnalysisCategoryKey(value: unknown, fallback: string): string {
  return (
    cleanText(value, 60)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || fallback
  );
}

function normalizeCategories(input: unknown): AnalysisProfileCategorySnapshot[] {
  const rows = Array.isArray(input) ? input : [];
  const seen = new Set<string>();

  return rows
    .map((item, index) => {
      const row =
        item && typeof item === "object" && !Array.isArray(item)
          ? (item as Record<string, unknown>)
          : {};
      const label = cleanText(row.label, 80);
      if (!label) {
        return null;
      }
      const baseKey = cleanAnalysisCategoryKey(row.key || label, `category_${index + 1}`);
      let key = baseKey;
      let suffix = 2;
      while (seen.has(key)) {
        const suffixText = `_${suffix}`;
        key = `${baseKey.slice(0, 40 - suffixText.length)}${suffixText}`;
        suffix += 1;
      }
      seen.add(key);

      return {
        key,
        label,
        description: cleanText(row.description, 600),
      };
    })
    .filter((category): category is AnalysisProfileCategorySnapshot => Boolean(category));
}

export function buildAnalysisProfileSnapshot(profile: WorkspaceProfile): AnalysisProfileSnapshot {
  const categories = normalizeCategories(profile.analysisCategories);

  return {
    version: 1,
    domain: cleanText(profile.domain, 160) || "General academic research",
    domainDefinition: String(profile.domainDefinition ?? "").trim().slice(0, 1200),
    taxonomyName: cleanText(profile.categoryTaxonomyName, 120) || "Project categories",
    taxonomyDefinition: String(profile.categoryTaxonomyDefinition ?? "").trim().slice(0, 1200),
    additionalContext: String(profile.analysisContext ?? "").trim().slice(0, 2000),
    categories,
  };
}

export function readCategoryLabelMap(
  profile: WorkspaceProfile
): Record<CategoryStorageSlot | "Other", string> {
  const snapshot = buildAnalysisProfileSnapshot(profile);
  return {
    EL: snapshot.categories[0]?.label || "Category 1",
    ELI: snapshot.categories[1]?.label || "Category 2",
    LAE: snapshot.categories[2]?.label || "Category 3",
    Other: "Other / Unclassified",
  };
}

export function sanitizeAnalysisProfilePayload(input: unknown): AnalysisProfileSnapshot {
  const payload =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};
  const categories = normalizeCategories(payload.categories);

  return {
    version: 1,
    domain: cleanText(payload.domain, 160) || "General academic research",
    domainDefinition: String(payload.domainDefinition ?? payload.domain_definition ?? "")
      .trim()
      .slice(0, 1200),
    taxonomyName: cleanText(payload.taxonomyName ?? payload.taxonomy_name, 120) || "Project categories",
    taxonomyDefinition: String(
      payload.taxonomyDefinition ??
        payload.taxonomy_definition ??
        payload.categoryTaxonomyDefinition ??
        payload.category_taxonomy_definition ??
        ""
    )
      .trim()
      .slice(0, 1200),
    additionalContext: String(payload.additionalContext ?? payload.additional_context ?? "")
      .trim()
      .slice(0, 2000),
    categories,
  };
}
