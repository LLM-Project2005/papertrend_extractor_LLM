import { createHmac, timingSafeEqual } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import {
  getGoogleClientId,
  getGoogleClientSecret,
  getGoogleDriveRedirectUri,
  getSiteUrl,
  getSupabaseServiceRoleKey,
} from "@/lib/server-env";

const GOOGLE_DRIVE_PROVIDER = "google_drive";
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.readonly",
];

export interface GoogleDriveConnectionRecord {
  id: string;
  user_id: string;
  provider: "google_drive";
  external_email?: string | null;
  external_user_id?: string | null;
  access_token?: string | null;
  refresh_token?: string | null;
  token_type?: string | null;
  scope?: string | null;
  expires_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  id_token?: string;
}

function getSigningSecret(): string {
  return getSupabaseServiceRoleKey() || getGoogleClientSecret();
}

function getBaseRedirectUrl(request?: Request): string {
  const explicit = getGoogleDriveRedirectUri();
  if (explicit) {
    return explicit;
  }

  const configuredSiteUrl = getSiteUrl();
  if (configuredSiteUrl) {
    return `${configuredSiteUrl.replace(/\/$/, "")}/api/integrations/google-drive/callback`;
  }

  if (!request) {
    throw new Error("GOOGLE_DRIVE_REDIRECT_URI is missing.");
  }

  const url = new URL(request.url);
  return `${url.origin}/api/integrations/google-drive/callback`;
}

function getOAuthConfig(request?: Request): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
} {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  const redirectUri = getBaseRedirectUrl(request);

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Google Drive OAuth is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_DRIVE_REDIRECT_URI."
    );
  }

  return { clientId, clientSecret, redirectUri };
}

function encodeState(payload: Record<string, unknown>): string {
  const json = JSON.stringify(payload);
  const encoded = Buffer.from(json, "utf-8").toString("base64url");
  const signature = createHmac("sha256", getSigningSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function decodeState<T extends Record<string, unknown>>(value: string): T {
  const [encoded, signature] = value.split(".");
  if (!encoded || !signature) {
    throw new Error("Invalid Google Drive state.");
  }

  const expected = createHmac("sha256", getSigningSecret())
    .update(encoded)
    .digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw new Error("Google Drive state verification failed.");
  }

  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8")) as T;
  return payload;
}

export function buildGoogleDriveAuthorizationUrl(
  userId: string,
  request: Request,
  returnTo?: string
): string {
  const { clientId, redirectUri } = getOAuthConfig(request);
  const state = encodeState({
    userId,
    returnTo: returnTo || "/workspace/home?analyze=1&source=google-drive",
    exp: Date.now() + 10 * 60 * 1000,
  });

  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGoogleCode(
  code: string,
  request?: Request
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig(request);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token exchange failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as GoogleTokenResponse;
}

export async function refreshGoogleAccessToken(
  refreshToken: string
): Promise<GoogleTokenResponse> {
  const { clientId, clientSecret } = getOAuthConfig();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    throw new Error(`Google token refresh failed: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as GoogleTokenResponse;
}

export async function fetchGoogleUserInfo(accessToken: string): Promise<{
  id?: string;
  email?: string;
}> {
  const response = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load Google user info: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as { id?: string; email?: string };
}

export async function upsertGoogleDriveConnection(
  userId: string,
  tokenPayload: GoogleTokenResponse,
  profile: { id?: string; email?: string }
): Promise<void> {
  const supabase = getSupabaseAdmin();
  const existing = await getGoogleDriveConnection(userId);
  const expiresAt = tokenPayload.expires_in
    ? new Date(Date.now() + tokenPayload.expires_in * 1000).toISOString()
    : null;

  const { error } = await supabase.from("google_drive_connections").upsert(
    {
      user_id: userId,
      provider: GOOGLE_DRIVE_PROVIDER,
      external_email: profile.email ?? null,
      external_user_id: profile.id ?? null,
      access_token: tokenPayload.access_token,
      refresh_token: tokenPayload.refresh_token ?? existing?.refresh_token ?? null,
      token_type: tokenPayload.token_type ?? null,
      scope: tokenPayload.scope ?? existing?.scope ?? GOOGLE_SCOPES.join(" "),
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider" }
  );

  if (error) {
    throw error;
  }
}

export async function getGoogleDriveConnection(
  userId: string
): Promise<GoogleDriveConnectionRecord | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("google_drive_connections")
    .select("*")
    .eq("user_id", userId)
    .eq("provider", GOOGLE_DRIVE_PROVIDER)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data ?? null) as GoogleDriveConnectionRecord | null;
}

export async function ensureGoogleDriveAccessToken(
  connection: GoogleDriveConnectionRecord
): Promise<string> {
  if (
    connection.access_token &&
    connection.expires_at &&
    new Date(connection.expires_at).getTime() > Date.now() + 60_000
  ) {
    return connection.access_token;
  }

  if (!connection.refresh_token) {
    if (connection.access_token) {
      return connection.access_token;
    }
    throw new Error("The Google Drive connection is missing a refresh token.");
  }

  const refreshed = await refreshGoogleAccessToken(connection.refresh_token);
  await upsertGoogleDriveConnection(connection.user_id, refreshed, {
    id: connection.external_user_id ?? undefined,
    email: connection.external_email ?? undefined,
  });
  return refreshed.access_token;
}

export async function listGoogleDrivePdfFiles(
  accessToken: string,
  search = ""
): Promise<
  Array<{
    id: string;
    name: string;
    mimeType?: string;
    size?: string;
    modifiedTime?: string;
    webViewLink?: string;
  }>
> {
  const query = ["mimeType='application/pdf'", "trashed=false"];
  if (search.trim()) {
    const safeSearch = search.replace(/'/g, "\\'");
    query.push(`name contains '${safeSearch}'`);
  }

  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("pageSize", "25");
  url.searchParams.set("orderBy", "modifiedTime desc");
  url.searchParams.set("fields", "files(id,name,mimeType,size,modifiedTime,webViewLink)");
  url.searchParams.set("q", query.join(" and "));

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to list Google Drive files: ${response.status} ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    files?: Array<{
      id: string;
      name: string;
      mimeType?: string;
      size?: string;
      modifiedTime?: string;
      webViewLink?: string;
    }>;
  };

  return payload.files ?? [];
}

export async function getGoogleDriveFileMetadata(
  accessToken: string,
  fileId: string
): Promise<{
  id: string;
  name: string;
  mimeType?: string;
  size?: string;
  modifiedTime?: string;
  webViewLink?: string;
}> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  url.searchParams.set("fields", "id,name,mimeType,size,modifiedTime,webViewLink");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch Google Drive file: ${response.status} ${await response.text()}`);
  }

  return (await response.json()) as {
    id: string;
    name: string;
    mimeType?: string;
    size?: string;
    modifiedTime?: string;
    webViewLink?: string;
  };
}
