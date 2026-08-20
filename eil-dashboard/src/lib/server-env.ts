export function getSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
}

function normalizeConfiguredValue(value: string | undefined): string {
  return (value ?? "").trim().replace(/^['"]|['"]$/g, "");
}

export function getSupabaseServiceRoleKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SERVICE_KEY ??
    ""
  );
}

export function getSupabaseAnonKey(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? "";
}

export type AuthProvider = "supabase" | "firebase";

export function getAuthProvider(): AuthProvider {
  // Keep the server switch authoritative, but allow Preview deployments that
  // only set the matching public switch to avoid silently verifying a Firebase
  // token with the Supabase adapter.
  const provider = (
    process.env.AUTH_PROVIDER ??
    process.env.NEXT_PUBLIC_AUTH_PROVIDER ??
    "supabase"
  ).trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  if (provider === "supabase" || provider === "") {
    return "supabase";
  }
  if (provider === "firebase" || provider === "identity-platform") {
    return "firebase";
  }
  throw new Error("Unsupported AUTH_PROVIDER configuration.");
}

export function getFirebaseProjectId(): string {
  return normalizeConfiguredValue(process.env.FIREBASE_PROJECT_ID);
}

export function getFirebaseClientEmail(): string {
  return normalizeConfiguredValue(process.env.FIREBASE_CLIENT_EMAIL);
}

export function getFirebasePrivateKey(): string {
  return process.env.FIREBASE_PRIVATE_KEY ?? "";
}

export function getFirebaseCheckRevoked(): boolean {
  const configured = process.env.FIREBASE_CHECK_REVOKED;
  if (configured === undefined) {
    return getAuthProvider() === "firebase";
  }
  return normalizeConfiguredValue(configured).toLowerCase() === "true";
}

export function getFirebaseAutoProvisionVerifiedUsers(): boolean {
  return normalizeConfiguredValue(
    process.env.FIREBASE_AUTO_PROVISION_VERIFIED_USERS
  ).toLowerCase() === "true";
}

export type DatabaseProvider = "supabase" | "cloud-sql";
export type StorageProvider = "supabase" | "gcs";

function normalizeProvider(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/_/g, "-");
}

export function getDatabaseProvider(): DatabaseProvider {
  const provider = normalizeProvider(
    process.env.DATABASE_PROVIDER ?? process.env.INFRA_PROVIDER
  );
  return provider === "cloud-sql" || provider === "google" ? "cloud-sql" : "supabase";
}

export function getStorageProvider(): StorageProvider {
  const provider = normalizeProvider(
    process.env.STORAGE_PROVIDER ?? process.env.INFRA_PROVIDER
  );
  return provider === "gcs" || provider === "google" ? "gcs" : "supabase";
}

export function getGoogleCloudProjectId(): string {
  return process.env.GOOGLE_CLOUD_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? "";
}

export function getGoogleCloudRegion(): string {
  return process.env.GOOGLE_CLOUD_REGION ?? "asia-southeast1";
}

export function getGcsUploadBucket(): string {
  return process.env.GCS_UPLOAD_BUCKET ?? "";
}

export function getCloudSqlInstanceConnectionName(): string {
  return process.env.CLOUD_SQL_INSTANCE_CONNECTION_NAME ?? "";
}

export function getDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? "";
}

export function getAdminImportSecret(): string {
  return (
    process.env.ADMIN_IMPORT_SECRET ??
    process.env.PAPERTREND_ADMIN_SECRET ??
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

export function getRepositoryEmbeddingConfig(): {
  model: string;
  dimensions: number;
  batchSize: number;
} {
  return {
    model: process.env.REPOSITORY_EMBEDDING_MODEL ?? "openai/text-embedding-3-small",
    dimensions: parseBoundedIntEnv("REPOSITORY_EMBEDDING_DIMENSIONS", 1536, 128, 4096),
    batchSize: parseBoundedIntEnv("REPOSITORY_EMBEDDING_BATCH_SIZE", 24, 1, 100),
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

export function getWorkerServiceUrl(): string {
  const explicit = process.env.WORKER_SERVICE_URL ?? "";
  if (explicit) {
    return explicit.replace(/\/$/, "");
  }
  return getPythonNodeServiceUrl();
}

export function getCronSecret(): string {
  return process.env.CRON_SECRET ?? "";
}

export function getWorkerWebhookSecret(): string {
  return process.env.WORKER_WEBHOOK_SECRET ?? process.env.CRON_SECRET ?? "";
}

export function getAllowedOrigins(): string[] {
  return (process.env.APP_ALLOWED_ORIGINS ?? process.env.NEXT_PUBLIC_SITE_URL ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

function parseBoundedIntEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

export function getLoginRateLimitAttempts(): number {
  return parseBoundedIntEnv("LOGIN_RATE_LIMIT_ATTEMPTS", 5, 1, 50);
}

export function getLoginRateLimitWindowSeconds(): number {
  return parseBoundedIntEnv("LOGIN_RATE_LIMIT_WINDOW_SECONDS", 900, 60, 86_400);
}

export function getAiDailyMessageLimit(): number {
  return parseBoundedIntEnv("AI_DAILY_MESSAGE_LIMIT", 100, 1, 10_000);
}

export function getAiDailyDeepResearchLimit(): number {
  return parseBoundedIntEnv("AI_DAILY_DEEP_RESEARCH_LIMIT", 10, 1, 1_000);
}

export function getMaxUploadBytes(): number {
  return parseBoundedIntEnv("MAX_UPLOAD_BYTES", 10 * 1024 * 1024, 1024, 250 * 1024 * 1024);
}

export function getAiDailyTokenLimit(): number {
  return parseBoundedIntEnv("AI_DAILY_TOKEN_LIMIT", 1_000_000, 1_000, 100_000_000);
}

export function getMaxPdfPages(): number {
  return parseBoundedIntEnv("MAX_PDF_PAGES", 80, 1, 1_000);
}
