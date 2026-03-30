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

export function getOpenAIConfig(taskName?: string): {
  apiKey: string;
  baseUrl: string;
  model: string;
} | null {
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) {
    return null;
  }

  const normalizedTaskName = taskName?.trim().toUpperCase();
  const taskModel =
    normalizedTaskName && normalizedTaskName.length > 0
      ? process.env[`MODEL_TASK_${normalizedTaskName}`]
      : undefined;

  return {
    apiKey,
    baseUrl: (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(
      /\/$/,
      ""
    ),
    model: taskModel ?? process.env.OPENAI_MODEL ?? "gpt-4.1-mini",
  };
}

export function getGoogleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID ?? "";
}

export function getGoogleClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET ?? "";
}

export function getGooglePickerApiKey(): string {
  return process.env.GOOGLE_PICKER_API_KEY ?? "";
}

export function getGoogleDriveRedirectUri(): string {
  return process.env.GOOGLE_DRIVE_REDIRECT_URI ?? "";
}

export function getSiteUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? "";
}

export function getPythonNodeServiceUrl(): string {
  return (process.env.PYTHON_NODE_SERVICE_URL ?? "").replace(/\/$/, "");
}
