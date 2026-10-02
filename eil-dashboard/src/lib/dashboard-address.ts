/*
 * The dashboard's view in its address (docs/32, 4.3): the repository, the
 * years, the categories and the search, beside the tab (?tab=), so a link opens
 * the same view. Only what differs from the default is written: every year and
 * every category are the default and leave no parameter.
 *
 *   /workspace/dashboard?tab=trend_analysis&repo=<id>&years=2019,2020&categories=el,lae&q=feedback
 */

export const ADDRESS_PARAMS = { repo: "repo", years: "years", categories: "categories", query: "q" } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const YEAR = /^(\d{4}|Unknown)$/;
const CATEGORY_KEY = /^[\p{L}\p{M}\p{N}_ .-]{1,80}$/u;
const MAX_YEARS = 80;
const MAX_CATEGORIES = 24;
export const MAX_ADDRESS_QUERY = 200;

export interface DashboardAddress {
  projectId: string | null;
  /** null: the address names no years (every year). */
  years: string[] | null;
  /** null: the address names no categories (every category). */
  categories: string[] | null;
  /** null: the address has no search. */
  query: string | null;
}

interface ParamsLike {
  get(name: string): string | null;
}

function list(value: string | null, pattern: RegExp, max: number): string[] | null {
  if (value === null) return null;
  const items = [...new Set(value.split(",").map((item) => item.trim()).filter((item) => pattern.test(item)))].slice(0, max);
  return items.length ? items : null;
}

/** What an address asks for; anything malformed is left out rather than trusted. */
export function readDashboardAddress(params: ParamsLike): DashboardAddress {
  const repo = params.get(ADDRESS_PARAMS.repo)?.trim() ?? "";
  const query = params.get(ADDRESS_PARAMS.query);
  return {
    projectId: UUID.test(repo) ? repo.toLowerCase() : null,
    years: list(params.get(ADDRESS_PARAMS.years), YEAR, MAX_YEARS),
    categories: list(params.get(ADDRESS_PARAMS.categories), CATEGORY_KEY, MAX_CATEGORIES),
    query: query === null ? null : query.slice(0, MAX_ADDRESS_QUERY),
  };
}

export function hasViewInAddress(address: DashboardAddress): boolean {
  return address.years !== null || address.categories !== null || address.query !== null;
}

const sameSet = (left: string[], right: string[]) =>
  left.length === right.length && left.every((item) => right.includes(item));

/**
 * The address for a view: `current` keeps its other parameters (the tab, an
 * open paper), and each view parameter is set, or removed when it is the default.
 */
export function withDashboardAddress(
  current: ParamsLike & { toString(): string },
  view: {
    projectId: string | null;
    years: string[];
    allYears: string[];
    categories: string[];
    allCategories: string[];
    query: string;
  }
): URLSearchParams {
  const params = new URLSearchParams(current.toString());
  const set = (name: string, value: string | null) => (value ? params.set(name, value) : params.delete(name));
  set(ADDRESS_PARAMS.repo, view.projectId);
  const everyYear = view.years.length === 0 || (view.allYears.length > 0 && sameSet(view.years, view.allYears));
  set(ADDRESS_PARAMS.years, everyYear ? null : [...view.years].sort().join(","));
  const everyCategory =
    view.categories.length === 0 || view.allCategories.length === 0 || sameSet(view.categories, view.allCategories);
  set(ADDRESS_PARAMS.categories, everyCategory ? null : [...view.categories].sort().join(","));
  set(ADDRESS_PARAMS.query, view.query.trim() ? view.query.trim().slice(0, MAX_ADDRESS_QUERY) : null);
  return params;
}
