import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  WorkspaceOrganizationRow,
  WorkspaceProjectRow,
} from "@/types/database";

export function sanitizeWorkspaceName(value: string, fallback: string) {
  const next = value.replace(/\s+/g, " ").trim();
  return next || fallback;
}

export async function ensureWorkspaceOrganization(
  supabase: SupabaseClient,
  ownerUserId: string,
  name: string,
  type: WorkspaceOrganizationRow["type"]
): Promise<WorkspaceOrganizationRow> {
  const payload = {
    owner_user_id: ownerUserId,
    name: sanitizeWorkspaceName(name, "Untitled organization"),
    type,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("workspace_organizations")
    .upsert(payload, { onConflict: "owner_user_id,name" })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to save organization.");
  }

  return data as WorkspaceOrganizationRow;
}

export async function createWorkspaceProject(
  supabase: SupabaseClient,
  ownerUserId: string,
  organizationId: string,
  name: string,
  description?: string | null
): Promise<WorkspaceProjectRow> {
  const { data, error } = await supabase
    .from("workspace_projects")
    .insert({
      owner_user_id: ownerUserId,
      organization_id: organizationId,
      name: sanitizeWorkspaceName(name, "Untitled project"),
      description: description?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Failed to create project.");
  }

  return data as WorkspaceProjectRow;
}
