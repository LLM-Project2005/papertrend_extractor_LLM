function validConfiguredOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new Error("APP_PUBLIC_URL must use HTTPS outside local development.");
  }
  return url.origin;
}

export function getPublicRequestOrigin(request: Request): string {
  const configured = process.env.APP_PUBLIC_URL?.trim() || process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return validConfiguredOrigin(configured);

  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  if (process.env.K_SERVICE && forwardedHost?.endsWith(".run.app") && forwardedProto === "https") {
    return "https://" + forwardedHost;
  }

  const origin = new URL(request.url).origin;
  if (process.env.NODE_ENV === "production" && ["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) {
    throw new Error("APP_PUBLIC_URL is required for asynchronous jobs.");
  }
  return origin;
}
