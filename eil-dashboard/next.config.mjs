/** @type {import('next').NextConfig} */

function originOf(value) {
  try {
    return value ? new URL(value).origin : "";
  } catch {
    return "";
  }
}

/*
 * Content-Security-Policy: where this site may load scripts, frames and
 * images from, and which hosts its pages may send data to. It limits what an
 * injected script could do - chiefly, it cannot send a signed-in session's
 * tokens to a host of its choosing.
 *
 * Script tags still allow 'unsafe-inline' because the framework writes its
 * hydration data inline; the policy's weight is in connect-src, frame-src,
 * object-src, base-uri, form-action and frame-ancestors.
 *
 * External origins, and why:
 *   apis.google.com, accounts.google.com  Google sign-in (Firebase) and the
 *                                         Drive Picker's scripts
 *   <auth domain>                         Firebase's sign-in iframe
 *   *.googleapis.com                      Firebase Auth, Drive downloads, and
 *                                         signed storage links (uploads, PDFs)
 *   docs.google.com, drive.google.com     the Drive Picker's frame
 *   storage.googleapis.com (frame)        the PDF viewer's fallback frame
 *   <direct API origin>                   chat streams straight from Cloud Run
 */
const directApiOrigin = originOf(process.env.NEXT_PUBLIC_DIRECT_API_URL);
const authDomain = (process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "").trim();
const authDomainOrigin = authDomain ? `https://${authDomain}` : "";

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://apis.google.com https://accounts.google.com https://www.gstatic.com",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com",
  // Avatars may be any https image, so images are not narrowed further.
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  ["connect-src 'self'", directApiOrigin, "https://*.googleapis.com https://accounts.google.com https://apis.google.com"]
    .filter(Boolean)
    .join(" "),
  ["frame-src 'self'", authDomainOrigin, "https://accounts.google.com https://docs.google.com https://drive.google.com https://storage.googleapis.com"]
    .filter(Boolean)
    .join(" "),
  "worker-src 'self' blob:",
  "media-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

// Enforced. It ran report-only on the pilot first, while every feature was
// exercised (landing videos, Google sign-in, the PDF viewer and its fallback
// frame, dashboards, streaming chat, uploads, the Drive Picker), and nothing
// was reported.
const CSP_HEADER = "Content-Security-Policy";

const securityHeaders = [
  { key: CSP_HEADER, value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

// The documentation was reorganized in September 2026. Old addresses, from
// bookmarks and earlier links, land on the page that now covers the subject.
const movedDocs = {
  "workspace-concepts": "repositories",
  "library-uploads": "uploading-papers",
  "google-drive-imports": "uploading-papers",
  "search-navigation": "repositories",
  "settings-profile": "account-and-settings",
  "paper-analysis": "analysis-pipeline",
  "research-dashboard": "dashboard",
  "ai-research-chat": "chat",
  "deep-research-agent": "deep-research",
  "cloud-queue": "uploading-papers",
  "evaluation-quality": "reading-a-paper",
};

const nextConfig = {
  // Nothing here uses the image optimizer (every image is served as stored),
  // so its endpoint, /_next/image, is switched off rather than left reachable.
  images: { unoptimized: true },
  // The framework is not announced in every response.
  poweredByHeader: false,
  async redirects() {
    return [
      ...Object.entries(movedDocs).map(([from, to]) => ({
        source: `/docs/${from}`,
        destination: `/docs/${to}`,
        permanent: true,
      })),
      // The documentation opens on Getting started; every page is in its sidebar.
      { source: "/docs", destination: "/docs/getting-started", permanent: false },
      // The Uploads feature page was retired (2026-10-09); uploading is covered in the docs.
      { source: "/features/cloud-queue", destination: "/docs/uploading-papers", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
      ...["/api/:path*", "/workspace/:path*", "/workspaces/:path*", "/admin/:path*"].map(
        (source) => ({
          source,
          headers: [
            {
              key: "Cache-Control",
              value: "private, no-store, max-age=0",
            },
          ],
        })
      ),
    ];
  },
};
export default nextConfig;
