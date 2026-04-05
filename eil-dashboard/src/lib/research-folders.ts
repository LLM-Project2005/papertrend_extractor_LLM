import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResearchFolderRow } from "@/types/database";

export function sanitizeFolderName(folderName: string): string {
  const sanitized = folderName
    .replace(/[^a-zA-Z0-9._/-]+/g, "-")
    .replace(/^\/+|\/+$/g, "")
    .trim();
  return sanitized || "Inbox";
}

export async function ensureResearchFolder(
  supabase: SupabaseClient,
  ownerUserId: string | null,
  projectId: string | null,
  folderName: string
): Promise<ResearchFolderRow | null> {
  if (!ownerUserId || !projectId) {
    return null;
  }

  const name = sanitizeFolderName(folderName);
  const { data: projectRow, error: projectError } = await supabase
    .from("workspace_projects")
    .select("organization_id")
    .eq("id", projectId)
    .eq("owner_user_id", ownerUserId)
    .maybeSingle();

  if (projectError) {
    throw new Error(projectError.message);
  }

  const { data: existingFolder, error: existingFolderError } = await supabase
    .from("research_folders")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .eq("project_id", projectId)
    .eq("name", name)
    .maybeSingle();

  if (existingFolderError) {
    throw new Error(existingFolderError.message);
  }

  if (existingFolder) {
    return existingFolder as ResearchFolderRow;
  }

  const { data, error } = await supabase
    .from("research_folders")
    .insert({
      owner_user_id: ownerUserId,
      organization_id: (projectRow as { organization_id?: string | null } | null)
        ?.organization_id ?? null,
      project_id: projectId,
      name,
      updated_at: new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: duplicateFolder, error: duplicateFolderError } = await supabase
        .from("research_folders")
        .select("*")
        .eq("owner_user_id", ownerUserId)
        .eq("project_id", projectId)
        .eq("name", name)
        .maybeSingle();

      if (duplicateFolderError) {
        throw new Error(duplicateFolderError.message);
      }

      if (duplicateFolder) {
        return duplicateFolder as ResearchFolderRow;
      }
    }

    throw new Error(error.message);
  }

  return (data ?? null) as ResearchFolderRow | null;
}
