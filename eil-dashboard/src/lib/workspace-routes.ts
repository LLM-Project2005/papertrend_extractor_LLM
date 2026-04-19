export const WORKSPACE_SECTIONS = [
  "home",
  "dashboard",
  "chat",
  "library",
  "logs",
  "settings",
  "profile",
  "imports",
  "papers",
] as const;

export type WorkspaceSection = (typeof WORKSPACE_SECTIONS)[number];

type WorkspaceRouteParams = {
  organizationId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  section?: WorkspaceSection;
  query?: URLSearchParams | Record<string, string | number | boolean | null | undefined>;
  hash?: string | null;
};

type WorkspaceSlugRouteParams = {
  organizationId: string;
  projectSlug: string;
  section?: WorkspaceSection;
  query?: URLSearchParams | Record<string, string | number | boolean | null | undefined>;
  hash?: string | null;
};

function normalizeHash(hash?: string | null) {
  if (!hash) {
    return "";
  }
  return hash.startsWith("#") ? hash : `#${hash}`;
}

function appendQueryAndHash(
  pathname: string,
  query?: URLSearchParams | Record<string, string | number | boolean | null | undefined>,
  hash?: string | null
) {
  const params =
    query instanceof URLSearchParams ? new URLSearchParams(query) : new URLSearchParams();

  if (query && !(query instanceof URLSearchParams)) {
    for (const [key, value] of Object.entries(query)) {
      if (value === null || value === undefined || value === "") {
        continue;
      }
      params.set(key, String(value));
    }
  }

  const queryString = params.toString();
  return `${pathname}${queryString ? `?${queryString}` : ""}${normalizeHash(hash)}`;
}

export function slugifyWorkspaceSegment(value: string) {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "project";
}

export function buildProjectSlug(projectName: string | null | undefined, projectId: string) {
  return `${slugifyWorkspaceSegment(projectName || "project")}--${projectId}`;
}

export function parseEntityIdFromSlug(value: string | null | undefined) {
  if (!value) {
    return "";
  }
  const separatorIndex = value.lastIndexOf("--");
  if (separatorIndex === -1) {
    return value;
  }
  return value.slice(separatorIndex + 2);
}

export function buildWorkspacePath({
  organizationId,
  projectId,
  projectName,
  section = "home",
  query,
  hash,
}: WorkspaceRouteParams) {
  if (!organizationId || !projectId) {
    return appendQueryAndHash("/organizations", query, hash);
  }

  const projectSlug = buildProjectSlug(projectName, projectId);
  return buildWorkspacePathFromSlug({
    organizationId,
    projectSlug,
    section,
    query,
    hash,
  });
}

export function buildWorkspacePathFromSlug({
  organizationId,
  projectSlug,
  section = "home",
  query,
  hash,
}: WorkspaceSlugRouteParams) {
  return appendQueryAndHash(
    `/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectSlug)}/workspace/${section}`,
    query,
    hash
  );
}

export function getWorkspaceSectionFromPathname(pathname: string | null | undefined) {
  if (!pathname) {
    return "home" as WorkspaceSection;
  }

  const match = pathname.match(/\/workspace\/([^/?#]+)/i);
  const section = match?.[1]?.toLowerCase();
  if (section && WORKSPACE_SECTIONS.includes(section as WorkspaceSection)) {
    return section as WorkspaceSection;
  }
  return "home" as WorkspaceSection;
}

export function isWorkspacePath(pathname: string | null | undefined) {
  return Boolean(pathname && pathname.includes("/workspace"));
}
