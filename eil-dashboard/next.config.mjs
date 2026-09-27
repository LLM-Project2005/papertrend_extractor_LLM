/** @type {import('next').NextConfig} */
const securityHeaders = [
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
    return Object.entries(movedDocs).map(([from, to]) => ({
      source: `/docs/${from}`,
      destination: `/docs/${to}`,
      permanent: true,
    }));
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
