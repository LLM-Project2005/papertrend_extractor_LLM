import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getDatabaseProvider } from "@/lib/server-env";
import {
  ensureWorkspaceOrganization,
  createWorkspaceProject,
} from "@/lib/workspace-organizations";
import { ensureResearchFolder } from "@/lib/research-folders";
import { CloudSqlWorkspaceRepository } from "@/lib/cloudsql/workspace-repository";
import type {
  ResearchFolderRow,
  WorkspaceOrganizationRow,
  WorkspaceProjectRow,
} from "@/types/database";

export interface WorkspaceRepository {
  listOrganizations(ownerUserId: string): Promise<WorkspaceOrganizationRow[]>;
  ensureOrganization(
    ownerUserId: string,
    name: string,
    type: WorkspaceOrganizationRow["type"]
  ): Promise<WorkspaceOrganizationRow>;
  listProjects(
    ownerUserId: string,
    organizationId?: string | null
  ): Promise<WorkspaceProjectRow[]>;
  createProject(
    ownerUserId: string,
    organizationId: string,
    name: string,
    description?: string | null
  ): Promise<WorkspaceProjectRow>;
  updateProject(
    ownerUserId: string,
    projectId: string,
    patch: { name: string; description?: string | null }
  ): Promise<WorkspaceProjectRow | null>;
  listFolders(
    ownerUserId: string,
    projectId?: string | null
  ): Promise<ResearchFolderRow[]>;
  ensureFolder(
    ownerUserId: string,
    projectId: string,
    name: string
  ): Promise<ResearchFolderRow>;
  updateFolder(
    ownerUserId: string,
    folderId: string,
    name: string
  ): Promise<ResearchFolderRow | null>;
}

class SupabaseWorkspaceRepository implements WorkspaceRepository {
  async listOrganizations(ownerUserId: string): Promise<WorkspaceOrganizationRow[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("workspace_organizations")
      .select("*")
      .eq("owner_user_id", ownerUserId)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as WorkspaceOrganizationRow[];
  }

  async ensureOrganization(
    ownerUserId: string,
    name: string,
    type: WorkspaceOrganizationRow["type"]
  ): Promise<WorkspaceOrganizationRow> {
    return ensureWorkspaceOrganization(getSupabaseAdmin(), ownerUserId, name, type);
  }

  async listProjects(
    ownerUserId: string,
    organizationId?: string | null
  ): Promise<WorkspaceProjectRow[]> {
    let query = getSupabaseAdmin()
      .from("workspace_projects")
      .select("*")
      .eq("owner_user_id", ownerUserId)
      .order("name", { ascending: true });
    if (organizationId) query = query.eq("organization_id", organizationId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as WorkspaceProjectRow[];
  }

  async createProject(
    ownerUserId: string,
    organizationId: string,
    name: string,
    description?: string | null
  ): Promise<WorkspaceProjectRow> {
    return createWorkspaceProject(
      getSupabaseAdmin(),
      ownerUserId,
      organizationId,
      name,
      description
    );
  }

  async updateProject(
    ownerUserId: string,
    projectId: string,
    patch: { name: string; description?: string | null }
  ): Promise<WorkspaceProjectRow | null> {
    const update: { name: string; description?: string | null; updated_at: string } = {
      name: patch.name.trim(),
      updated_at: new Date().toISOString(),
    };
    if (patch.description !== undefined) update.description = patch.description;
    const { data, error } = await getSupabaseAdmin()
      .from("workspace_projects")
      .update(update)
      .eq("id", projectId)
      .eq("owner_user_id", ownerUserId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as WorkspaceProjectRow | null;
  }

  async listFolders(
    ownerUserId: string,
    projectId?: string | null
  ): Promise<ResearchFolderRow[]> {
    let query = getSupabaseAdmin()
      .from("research_folders")
      .select("*")
      .eq("owner_user_id", ownerUserId)
      .order("name", { ascending: true });
    if (projectId) query = query.eq("project_id", projectId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return (data ?? []) as ResearchFolderRow[];
  }

  async ensureFolder(
    ownerUserId: string,
    projectId: string,
    name: string
  ): Promise<ResearchFolderRow> {
    const folder = await ensureResearchFolder(
      getSupabaseAdmin(),
      ownerUserId,
      projectId,
      name
    );
    if (!folder) throw new Error("Failed to create workspace folder.");
    return folder;
  }

  async updateFolder(
    ownerUserId: string,
    folderId: string,
    name: string
  ): Promise<ResearchFolderRow | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("research_folders")
      .update({ name: name.trim(), updated_at: new Date().toISOString() })
      .eq("id", folderId)
      .eq("owner_user_id", ownerUserId)
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as ResearchFolderRow | null;
  }
}

export function getWorkspaceRepository(): WorkspaceRepository {
  return getDatabaseProvider() === "cloud-sql"
    ? new CloudSqlWorkspaceRepository()
    : new SupabaseWorkspaceRepository();
}
