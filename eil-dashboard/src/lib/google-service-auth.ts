const METADATA_IDENTITY_URL =
  "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity";

function isGoogleRuntime(): boolean {
  return Boolean(process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT);
}

export async function serviceAuthorizationHeader(
  audience: string,
  sharedSecret?: string
): Promise<string | null> {
  if (isGoogleRuntime()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    try {
      const response = await fetch(
        `${METADATA_IDENTITY_URL}?audience=${encodeURIComponent(audience)}&format=full`,
        {
          headers: { "Metadata-Flavor": "Google" },
          cache: "no-store",
          signal: controller.signal,
        }
      );
      if (response.ok) {
        const token = (await response.text()).trim();
        if (token) return `Bearer ${token}`;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return sharedSecret ? `Bearer ${sharedSecret}` : null;
}
