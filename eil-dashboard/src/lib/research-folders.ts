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
  folderName: string
): Promise<ResearchFolderRow | null> {
  if (!ownerUserId) {
    return null;
  }

  const name = sanitizeFolderName(folderName);
  const { data, error } = await supabase
    .from("research_folders")
    .upsert(
      {
        owner_user_id: ownerUserId,
        name,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_user_id,name" }
    )
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? null) as ResearchFolderRow | null;
}
