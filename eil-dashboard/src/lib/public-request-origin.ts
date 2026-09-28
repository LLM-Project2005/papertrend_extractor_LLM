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

  // This origin is where job callbacks are sent, and they carry the worker
  // secret, so it is never taken from request headers: a forwarded host is
  // whatever the caller wrote, and anyone can own a *.run.app name. On Cloud
  // Run the configured address is required.
  if (process.env.K_SERVICE) {
    throw new Error("APP_PUBLIC_URL is required for asynchronous jobs.");
  }

  const origin = new URL(request.url).origin;
  if (process.env.NODE_ENV === "production" && ["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) {
    throw new Error("APP_PUBLIC_URL is required for asynchronous jobs.");
  }
  return origin;
}
