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
  const { data: projectRow } = await supabase
    .from("workspace_projects")
    .select("organization_id")
    .eq("id", projectId)
    .eq("owner_user_id", ownerUserId)
    .single();

  const { data, error } = await supabase
    .from("research_folders")
    .upsert(
      {
        owner_user_id: ownerUserId,
        organization_id: (projectRow as { organization_id?: string | null } | null)
          ?.organization_id ?? null,
        project_id: projectId,
        name,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_user_id,project_id,name" }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as ResearchFolderRow | null;
}
