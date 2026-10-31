"use client";

import { TRACK_COLORS, TRACK_COLS, TRACK_NAMES, type TrackKey } from "@/lib/constants";
import { selectedCategoryKeys, type CategoryOption } from "@/lib/category-options";
import type { ResearchFolderRow } from "@/types/database";
import { selectedClass } from "@/components/ui/controls";

interface Props {
  allYears: string[];
  selectedYears: string[];
  onYearsChange: (y: string[]) => void;
  selectedTracks: string[];
  onTracksChange: (t: string[]) => void;
  categoryOptions?: CategoryOption[];
  folders?: ResearchFolderRow[];
  selectedFolderIds?: string[];
  allFoldersSelected?: boolean;
  onFolderChange?: (folderIds: string[], allSelected: boolean) => void;
  useMock: boolean;
  title?: string;
  description?: string;
  showHeader?: boolean;
  showFolders?: boolean;
  /** False when the repository does not classify papers: there is nothing to filter by. */
  showCategories?: boolean;
}

export default function Sidebar({
  allYears,
  selectedYears,
  onYearsChange,
  selectedTracks,
  onTracksChange,
  categoryOptions,
  folders = [],
  selectedFolderIds = [],
  allFoldersSelected = true,
  onFolderChange,
  useMock,
  title = "Filters",
  description = "Narrow the dataset before exploring the analytics.",
  showHeader = true,
  showFolders = true,
  showCategories = true,
}: Props) {
  const normalizedSelectedFolderIds = [...new Set(selectedFolderIds.filter(Boolean))];
  const allYearsSelected =
    selectedYears.length === 0 || selectedYears.length === allYears.length;
  const effectiveCategoryOptions =
    categoryOptions && categoryOptions.length > 0
      ? categoryOptions
      : TRACK_COLS.map((track) => ({
          key: track,
          label: TRACK_NAMES[track as TrackKey],
          color: TRACK_COLORS[track as TrackKey],
          isOther: track === "Other",
        }));
  const normalizedSelectedCategoryKeys = selectedCategoryKeys(
    selectedTracks,
    effectiveCategoryOptions
  );
  const allCategoriesSelected =
    normalizedSelectedCategoryKeys.length === 0 ||
    normalizedSelectedCategoryKeys.length === effectiveCategoryOptions.length;

  const toggleYear = (year: string) => {
    if (allYearsSelected) {
      onYearsChange([year]);
      return;
    }

    if (selectedYears.includes(year)) {
      const nextYears = selectedYears.filter((value) => value !== year);
      onYearsChange(nextYears.length > 0 ? nextYears : []);
      return;
    }

    onYearsChange([...selectedYears, year].sort());
  };

  const toggleTrack = (track: string) => {
    if (allCategoriesSelected) {
      onTracksChange([track]);
      return;
    }
    onTracksChange(
      normalizedSelectedCategoryKeys.includes(track)
        ? normalizedSelectedCategoryKeys.filter((value) => value !== track)
        : [...normalizedSelectedCategoryKeys, track]
    );
  };

  const toggleFolder = (folderId: string) => {
    if (!onFolderChange) {
      return;
    }

    const nextFolderIds = normalizedSelectedFolderIds.includes(folderId)
      ? normalizedSelectedFolderIds.filter((value) => value !== folderId)
      : [...normalizedSelectedFolderIds, folderId];

    onFolderChange(nextFolderIds, nextFolderIds.length === 0);
  };

  return (
    <aside className="overflow-hidden rounded-xl border border-hairline bg-surface">
      {showHeader && (
        <div className="border-b border-hairline px-5 py-4">
          <h2 className="text-base font-semibold text-ink">
            {title}
          </h2>
          <p className="mt-1 text-sm text-mute">
            {description}
          </p>
        </div>
      )}

      <div className="space-y-6 px-5 py-5">
        {useMock && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
            Showing preview data until Supabase is connected and populated.
          </div>
        )}

        {showFolders && onFolderChange ? (
          <section>
            <h3 className="mb-3 text-xs font-medium text-mute">
              Folders
            </h3>
            <div className="space-y-3">
              <button
                type="button"
                onClick={() => onFolderChange([], true)}
                className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                  allFoldersSelected
                    ? "border-ink bg-subtle font-medium text-ink"
                    : "border-hairline bg-surface text-body hover:border-hairline-strong hover:text-ink"
                }`}
              >
                All folders
              </button>
              <div className="flex flex-wrap gap-2">
                {folders.map((folder) => {
                  const active =
                    !allFoldersSelected && normalizedSelectedFolderIds.includes(folder.id);
                  return (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => toggleFolder(folder.id)}
                      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? "border-ink bg-subtle font-medium text-ink"
                          : "border-hairline bg-surface text-body hover:border-hairline-strong hover:text-ink"
                      }`}
                    >
                      {folder.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs leading-6 text-mute">
                {allFoldersSelected
                  ? "Showing every folder in this project."
                  : `Showing ${normalizedSelectedFolderIds.length} selected folder${
                      normalizedSelectedFolderIds.length === 1 ? "" : "s"
                    }.`}
              </p>
            </div>
          </section>
        ) : null}

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-xs font-medium text-mute">
              Years
            </h3>
            <button
              type="button"
              className="-my-2 rounded px-1 py-2 text-xs font-medium text-mute hover:text-ink"
              onClick={() => onYearsChange([])}
            >
              Show all
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {allYears.map((year) => {
              const active = allYearsSelected || selectedYears.includes(year);
              return (
                <button
                  key={year}
                  type="button"
                  onClick={() => toggleYear(year)}
                  className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    active
                      ? "border-ink bg-subtle font-medium text-ink"
                      : "border-hairline bg-surface text-body hover:border-hairline-strong hover:text-ink"
                  }`}
                >
                  {year}
                </button>
              );
            })}
          </div>
        </section>

        {showCategories ? <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h3 className="text-xs font-medium text-mute">
              Research areas
            </h3>
            <button
              type="button"
              className="-my-2 rounded px-1 py-2 text-xs font-medium text-mute hover:text-ink"
              onClick={() => onTracksChange([])}
            >
              Show all
            </button>
          </div>
          <div className="space-y-2">
            {effectiveCategoryOptions.map((category) => {
              const active =
                allCategoriesSelected ||
                normalizedSelectedCategoryKeys.includes(category.key);
              return (
                <button
                  key={category.key}
                  type="button"
                  onClick={() => toggleTrack(category.key)}
                  className={`flex w-full items-start justify-between rounded-xl border px-3 py-3 text-left transition-colors ${
                    active
                      ? `border-hairline ${selectedClass}`
                      : "border-hairline bg-surface text-ink hover:border-hairline-strong"
                  }`}
                >
                  <span>
                    <span className="block text-sm font-medium">{category.label}</span>
                    <span
                      className={`mt-1 block text-xs ${
                        active
                          ? "opacity-80"
                          : "text-mute"
                      }`}
                    >
                      {category.isOther ? "Fallback research area" : category.key}
                    </span>
                  </span>
                  <span
                    className="mt-0.5 h-2.5 w-2.5 rounded-full"
                    style={{
                      backgroundColor: active ? category.color : "rgb(var(--hairline-strong))",
                    }}
                  />
                </button>
              );
            })}
          </div>
        </section> : null}

        <p className="text-xs leading-6 text-mute">
          Data source: analyzed research outputs in this repository.
        </p>
      </div>
    </aside>
  );
}
