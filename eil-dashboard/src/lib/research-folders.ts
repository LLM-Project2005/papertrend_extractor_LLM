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

  const { data: legacyFolders, error: legacyFolderError } = await supabase
    .from("research_folders")
    .select("*")
    .eq("owner_user_id", ownerUserId)
    .eq("name", name)
    .is("project_id", null)
    .limit(1);

  if (legacyFolderError) {
    throw new Error(legacyFolderError.message);
  }

  const legacyFolder = Array.isArray(legacyFolders) ? legacyFolders[0] : null;
  if (legacyFolder?.id) {
    const { data: migratedFolder, error: migratedFolderError } = await supabase
      .from("research_folders")
      .update({
        organization_id: (projectRow as { organization_id?: string | null } | null)
          ?.organization_id ?? null,
        project_id: projectId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", legacyFolder.id)
      .eq("owner_user_id", ownerUserId)
      .select("*")
      .single();

    if (migratedFolderError) {
      throw new Error(migratedFolderError.message);
    }

    return (migratedFolder ?? legacyFolder) as ResearchFolderRow;
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

      const { data: legacyDuplicateFolders, error: legacyDuplicateError } = await supabase
        .from("research_folders")
        .select("*")
        .eq("owner_user_id", ownerUserId)
        .eq("name", name)
        .limit(1);

      if (legacyDuplicateError) {
        throw new Error(legacyDuplicateError.message);
      }

      const legacyDuplicate = Array.isArray(legacyDuplicateFolders)
        ? legacyDuplicateFolders[0]
        : null;
      if (legacyDuplicate?.id && !legacyDuplicate.project_id) {
        const { data: migratedDuplicate, error: migratedDuplicateError } = await supabase
          .from("research_folders")
          .update({
            organization_id: (projectRow as { organization_id?: string | null } | null)
              ?.organization_id ?? null,
            project_id: projectId,
            updated_at: new Date().toISOString(),
          })
          .eq("id", legacyDuplicate.id)
          .eq("owner_user_id", ownerUserId)
          .select("*")
          .single();

        if (migratedDuplicateError) {
          throw new Error(migratedDuplicateError.message);
        }

        return (migratedDuplicate ?? legacyDuplicate) as ResearchFolderRow;
      }

      if (legacyDuplicate?.id) {
        throw new Error(
          "A folder with this name already exists in another project. Run the research_folders project-scoped uniqueness migration before creating duplicate folder names across projects."
        );
      }
    }

    throw new Error(error.message);
  }

  return (data ?? null) as ResearchFolderRow | null;
}
