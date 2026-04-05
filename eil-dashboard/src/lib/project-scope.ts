import type { SupabaseClient } from "@supabase/supabase-js";

export async function resolveProjectFolderIds(
  supabase: SupabaseClient,
  ownerUserId: string,
  projectId?: string | null,
  folderId?: string | null
): Promise<string[]> {
  if (folderId && folderId !== "all") {
    return [folderId];
  }

  if (!projectId) {
    return [];
  }

  const { data, error } = await supabase
    .from("research_folders")
    .select("id")
    .eq("owner_user_id", ownerUserId)
    .eq("project_id", projectId)
    .order("name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? [])
    .map((row) => String((row as { id?: string | null }).id || ""))
    .filter(Boolean);
}
