export function getSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
}

export function getSupabaseServiceRoleKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    ""
  );
}

export function getAdminImportSecret(): string {
  return (
    process.env.ADMIN_IMPORT_SECRET ??
    process.env.EIL_ADMIN_SECRET ??
    ""
  );
}

export function getOpenAIConfig(): {
  apiKey: string;
  baseUrl: string;
  model: string;
} | null {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(
      /\/$/,
      ""
    ),
    model: process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  };
}
