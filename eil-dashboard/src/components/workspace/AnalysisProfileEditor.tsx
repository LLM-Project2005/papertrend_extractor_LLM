"use client";

import { useMemo } from "react";
import {
  MAX_CUSTOM_CATEGORIES,
  MIN_CUSTOM_CATEGORIES,
  createEilAnalysisProfile,
  createGeneralAnalysisProfile,
  sanitizeProjectAnalysisProfile,
} from "@/lib/project-analysis-profile";
import { ChevronDownIcon, TrashIcon } from "@/components/ui/Icons";
import type { ProjectAnalysisProfile, WorkspaceAnalysisCategory } from "@/types/workspace";

export interface AnalysisProfileTemplate {
  projectId: string;
  projectName: string;
  profile: ProjectAnalysisProfile;
}

interface AnalysisProfileEditorProps {
  value: ProjectAnalysisProfile;
  onChange: (profile: ProjectAnalysisProfile) => void;
  templates?: AnalysisProfileTemplate[];
  compact?: boolean;
  error?: string | null;
}

function categoryDraft(index: number): WorkspaceAnalysisCategory {
  return {
    key: `category_${index + 1}`,
    label: "",
    description: "",
  };
}

function customDraft(source?: ProjectAnalysisProfile): ProjectAnalysisProfile {
  try {
    if (source?.mode === "custom") return sanitizeProjectAnalysisProfile(source);
  } catch {
    // Preserve incomplete form values while the user is editing.
  }
  return {
    version: 2,
    mode: "custom",
    displayName: "Custom Taxonomy",
    domain: source?.domain || "General academic research",
    domainDefinition: source?.domainDefinition || "",
    taxonomyName: "Custom Taxonomy",
    taxonomyDefinition: "",
    additionalContext: source?.additionalContext || "",
    classificationEnabled: true,
    categories: [categoryDraft(0), categoryDraft(1)],
    profileHash: "draft",
  };
}

function updateDraft(
  value: ProjectAnalysisProfile,
  patch: Partial<ProjectAnalysisProfile>
): ProjectAnalysisProfile {
  return { ...value, ...patch, version: 2, profileHash: "draft" };
}

export function profileSummary(profile: ProjectAnalysisProfile): string {
  if (!profile.classificationEnabled) return "General Research - no forced categories";
  return `${profile.taxonomyName} - ${profile.categories.map((item) => item.label).filter(Boolean).join(", ")}`;
}

export default function AnalysisProfileEditor({
  value,
  onChange,
  templates = [],
  compact = false,
  error,
}: AnalysisProfileEditorProps) {
  const options = useMemo(
    () => [
      {
        id: "general" as const,
        name: "General Research",
        description: "Recommended for most disciplines. Extracts research signals without forcing a category.",
      },
      {
        id: "eil" as const,
        name: "EIL Tracks",
        description: "Uses the official EL, ELI, and LAE definitions and boundary rules.",
      },
      {
        id: "custom" as const,
        name: "Custom Taxonomy",
        description: "Create 2-12 categories tailored to this repository.",
      },
    ],
    []
  );
  const categoryIssues = useMemo(() => {
    if (value.mode !== "custom") return [];
    const normalizedLabels = value.categories.map((category) => category.label.trim().toLocaleLowerCase());
    return value.categories.map((category, index) => ({
      label: !category.label.trim()
        ? "Enter a category name."
        : normalizedLabels.filter((label) => label && label === normalizedLabels[index]).length > 1
          ? "Category names must be unique."
          : null,
      description: !category.description.trim() ? "Explain what evidence belongs in this category." : null,
    }));
  }, [value]);

  function chooseMode(mode: "general" | "eil" | "custom") {
    if (mode === "general") onChange(createGeneralAnalysisProfile());
    else if (mode === "eil") onChange(createEilAnalysisProfile());
    else onChange(customDraft(value));
  }

  function updateCategory(index: number, patch: Partial<WorkspaceAnalysisCategory>) {
    const categories = value.categories.map((category, itemIndex) =>
      itemIndex === index
        ? {
            ...category,
            ...patch,
            key:
              patch.label !== undefined
                ? patch.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `category_${index + 1}`
                : category.key,
          }
        : category
    );
    onChange(updateDraft(value, { categories }));
  }

  function moveCategory(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= value.categories.length) return;
    const categories = [...value.categories];
    [categories[index], categories[target]] = [categories[target], categories[index]];
    onChange(updateDraft(value, { categories }));
  }

  return (
    <div className="space-y-5">
      <fieldset>
        <legend className="text-sm font-semibold text-slate-900 dark:text-white">Analysis profile</legend>
        <div className={`mt-3 grid gap-2 ${compact ? "" : "md:grid-cols-3"}`}>
          {options.map((option) => {
            const selected = value.mode === option.id;
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={selected}
                onClick={() => chooseMode(option.id)}
                className={`min-h-24 rounded-lg border px-4 py-3 text-left transition-colors ${
                  selected
                    ? "border-slate-950 bg-slate-950 text-white dark:border-white dark:bg-white dark:text-black"
                    : "border-slate-200 bg-white text-slate-900 hover:border-slate-400 dark:border-[#242424] dark:bg-black dark:text-white dark:hover:border-[#555]"
                }`}
              >
                <span className="block text-sm font-semibold">{option.name}</span>
                <span className={`mt-1.5 block text-xs leading-5 ${selected ? "text-white/75 dark:text-black/65" : "text-slate-500 dark:text-[#999]"}`}>
                  {option.description}
                </span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {value.mode === "eil" ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-4 dark:border-[#242424] dark:bg-[#080808]">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Official EIL categories</p>
          <dl className="mt-3 grid gap-3 text-sm md:grid-cols-3">
            {value.categories.map((category) => (
              <div key={category.key}>
                <dt className="font-medium text-slate-900 dark:text-white">{category.label}</dt>
                <dd className="mt-1 leading-5 text-slate-500 dark:text-[#999]">{category.description}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 border-t border-slate-200 pt-3 text-xs leading-5 text-slate-500 dark:border-[#242424] dark:text-[#999]">
            {value.taxonomyDefinition}
          </p>
        </div>
      ) : null}

      {value.mode === "custom" ? (
        <div className="space-y-4 border-t border-slate-200 pt-5 dark:border-[#242424]">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="grid gap-2 text-sm font-medium text-slate-800 dark:text-[#ddd]">
              Taxonomy name
              <input
                value={value.taxonomyName}
                onChange={(event) => onChange(updateDraft(value, { taxonomyName: event.target.value, displayName: event.target.value }))}
                maxLength={120}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base font-normal outline-none focus:border-slate-500 dark:border-[#242424] dark:bg-black dark:text-white sm:text-sm"
              />
            </label>
            <label className="grid gap-2 text-sm font-medium text-slate-800 dark:text-[#ddd]">
              Research domain
              <input
                value={value.domain}
                onChange={(event) => onChange(updateDraft(value, { domain: event.target.value }))}
                maxLength={160}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base font-normal outline-none focus:border-slate-500 dark:border-[#242424] dark:bg-black dark:text-white sm:text-sm"
              />
            </label>
          </div>
          <label className="grid gap-2 text-sm font-medium text-slate-800 dark:text-[#ddd]">
            Purpose and inclusion boundaries
            <textarea
              rows={3}
              value={value.taxonomyDefinition}
              onChange={(event) => onChange(updateDraft(value, { taxonomyDefinition: event.target.value }))}
              maxLength={1200}
              className="resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base font-normal leading-6 outline-none focus:border-slate-500 dark:border-[#242424] dark:bg-black dark:text-white sm:text-sm"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium text-slate-800 dark:text-[#ddd]">
            Domain definition
            <textarea
              rows={2}
              value={value.domainDefinition}
              onChange={(event) => onChange(updateDraft(value, { domainDefinition: event.target.value }))}
              maxLength={1200}
              className="resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base font-normal leading-6 outline-none focus:border-slate-500 dark:border-[#242424] dark:bg-black dark:text-white sm:text-sm"
            />
          </label>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Categories</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-[#999]">Other / Unclassified is always available automatically.</p>
              </div>
              <span className="text-xs text-slate-500 dark:text-[#999]">{value.categories.length}/{MAX_CUSTOM_CATEGORIES}</span>
            </div>
            {value.categories.map((category, index) => (
              <div key={index} className="grid min-w-0 gap-3 rounded-lg border border-slate-200 p-3 dark:border-[#242424] md:grid-cols-[minmax(130px,0.65fr)_minmax(220px,1.35fr)_auto]">
                <label className="grid min-w-0 gap-1.5">
                  <span className="sr-only">Category {index + 1} name</span>
                  <input
                    aria-invalid={Boolean(categoryIssues[index]?.label)}
                    aria-describedby={categoryIssues[index]?.label ? `category-${index}-name-error` : undefined}
                    value={category.label}
                    onChange={(event) => updateCategory(index, { label: event.target.value })}
                    placeholder="Category name"
                    maxLength={80}
                    className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-slate-500 aria-[invalid=true]:border-red-500 dark:border-[#242424] dark:bg-black dark:text-white sm:text-sm"
                  />
                  {categoryIssues[index]?.label ? <span id={`category-${index}-name-error`} className="text-xs text-red-600 dark:text-red-300">{categoryIssues[index].label}</span> : null}
                </label>
                <label className="grid min-w-0 gap-1.5">
                  <span className="sr-only">Category {index + 1} description</span>
                  <input
                    aria-invalid={Boolean(categoryIssues[index]?.description)}
                    aria-describedby={categoryIssues[index]?.description ? `category-${index}-description-error` : undefined}
                    value={category.description}
                    onChange={(event) => updateCategory(index, { description: event.target.value })}
                    placeholder="What evidence belongs here?"
                    maxLength={600}
                    className="min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-base outline-none focus:border-slate-500 aria-[invalid=true]:border-red-500 dark:border-[#242424] dark:bg-black dark:text-white sm:text-sm"
                  />
                  {categoryIssues[index]?.description ? <span id={`category-${index}-description-error`} className="text-xs text-red-600 dark:text-red-300">{categoryIssues[index].description}</span> : null}
                </label>
                <div className="flex items-center justify-end gap-1">
                  <button type="button" disabled={index === 0} onClick={() => moveCategory(index, -1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-30 dark:border-[#242424] dark:text-[#aaa] dark:hover:bg-[#111]" aria-label="Move category up" title="Move up"><ChevronDownIcon className="h-4 w-4 rotate-180" /></button>
                  <button type="button" disabled={index === value.categories.length - 1} onClick={() => moveCategory(index, 1)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-30 dark:border-[#242424] dark:text-[#aaa] dark:hover:bg-[#111]" aria-label="Move category down" title="Move down"><ChevronDownIcon className="h-4 w-4" /></button>
                  <button type="button" disabled={value.categories.length <= MIN_CUSTOM_CATEGORIES} onClick={() => onChange(updateDraft(value, { categories: value.categories.filter((_, itemIndex) => itemIndex !== index) }))} className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-slate-600 hover:border-red-300 hover:text-red-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-30 dark:border-[#242424] dark:text-[#aaa] dark:hover:border-red-900 dark:hover:text-red-300" aria-label={`Remove ${category.label || `category ${index + 1}`}`} title="Remove category"><TrashIcon className="h-4 w-4" /></button>
                </div>
              </div>
            ))}
            <button
              type="button"
              disabled={value.categories.length >= MAX_CUSTOM_CATEGORIES}
              onClick={() => onChange(updateDraft(value, { categories: [...value.categories, categoryDraft(value.categories.length)] }))}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40 dark:border-[#333] dark:text-[#ddd] dark:hover:bg-[#0a0a0a]"
            >
              Add category
            </button>
          </div>
          <label className="grid gap-2 text-sm font-medium text-slate-800 dark:text-[#ddd]">
            Additional guidance
            <textarea
              rows={2}
              value={value.additionalContext}
              onChange={(event) => onChange(updateDraft(value, { additionalContext: event.target.value }))}
              maxLength={2000}
              className="resize-y rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-base font-normal leading-6 outline-none focus:border-slate-500 dark:border-[#242424] dark:bg-black dark:text-white sm:text-sm"
            />
          </label>
        </div>
      ) : null}

      {templates.length > 0 ? (
        <label className="grid gap-2 text-sm font-medium text-slate-800 dark:text-[#ddd]">
          Copy from repository
          <select
            defaultValue=""
            onChange={(event) => {
              const template = templates.find((item) => item.projectId === event.target.value);
              if (template) onChange({ ...template.profile, categories: template.profile.categories.map((category) => ({ ...category })) });
              event.currentTarget.value = "";
            }}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 font-normal dark:border-[#242424] dark:bg-black dark:text-white"
          >
            <option value="">Choose a repository profile...</option>
            {templates.map((template) => <option key={template.projectId} value={template.projectId}>{template.projectName} - {template.profile.displayName}</option>)}
          </select>
        </label>
      ) : null}

      {error ? <p className="text-sm text-red-600 dark:text-red-300" role="alert">{error}</p> : null}
    </div>
  );
}
