import { TOPIC_PALETTE, TRACK_COLS, TRACK_NAMES, type TrackKey } from "@/lib/constants";
import type { DashboardData } from "@/types/database";
import type { WorkspaceProfile } from "@/types/workspace";

export interface CategoryOption {
  key: string;
  label: string;
  description?: string;
  color: string;
  isOther?: boolean;
}

export function normalizeCategoryKey(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export function categoryColor(key: string, index = 0): string {
  const directTrack = TRACK_COLS.find((track) => track === key) as TrackKey | undefined;
  if (directTrack) {
    return {
      EL: "#4a7fe5",
      ELI: "#e05c5c",
      LAE: "#3cba83",
      Other: "#9b7fd4",
    }[directTrack];
  }
  const seed = [...normalizeCategoryKey(key)].reduce(
    (sum, char) => sum + char.charCodeAt(0),
    index
  );
  return TOPIC_PALETTE[Math.abs(seed) % TOPIC_PALETTE.length];
}

export function buildCategoryOptions(
  data: Pick<DashboardData, "categoryAssignments"> | null | undefined,
  profile?: WorkspaceProfile | null,
  legacyLabels?: Record<TrackKey, string>
): CategoryOption[] {
  const options = new Map<string, Omit<CategoryOption, "color">>();

  profile?.analysisCategories?.forEach((category) => {
    const label = String(category.label ?? "").trim();
    if (!label) {
      return;
    }
    const key = normalizeCategoryKey(category.key || label) || `category_${options.size + 1}`;
    options.set(key, {
      key,
      label,
      description: category.description,
    });
  });

  (data?.categoryAssignments ?? []).forEach((assignment) => {
    const key = normalizeCategoryKey(assignment.category_key || assignment.category_label);
    const label = String(assignment.category_label ?? "").trim();
    if (!key || !label || options.has(key)) {
      return;
    }
    options.set(key, {
      key,
      label,
      isOther: Boolean(assignment.is_other) || key === "other",
    });
  });

  if (options.size === 0) {
    TRACK_COLS.forEach((track) => {
      options.set(track, {
        key: track,
        label: legacyLabels?.[track as TrackKey] || TRACK_NAMES[track as TrackKey],
        isOther: track === "Other",
      });
    });
  } else if (!options.has("other")) {
    options.set("other", {
      key: "other",
      label: "Other / Unclassified",
      isOther: true,
    });
  }

  return [...options.values()].map((option, index) => ({
    ...option,
    color: categoryColor(option.key, index),
  }));
}

export function selectedCategoryKeys(
  selectedKeys: string[],
  categoryOptions: CategoryOption[]
): string[] {
  const available = new Set(categoryOptions.map((option) => option.key));
  return selectedKeys.filter((key) => available.has(key));
}
