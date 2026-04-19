import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function buildRedirectUrl(request: NextRequest, section: string) {
  const organizationId = request.cookies.get("papertrend_workspace_org")?.value?.trim();
  const projectSlug = request.cookies
    .get("papertrend_workspace_project_slug")
    ?.value?.trim();

  if (!organizationId || !projectSlug) {
    return null;
  }

  const url = request.nextUrl.clone();
  url.pathname = `/organizations/${encodeURIComponent(
    organizationId
  )}/projects/${encodeURIComponent(projectSlug)}/workspace/${section}`;
  return url;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/workspace" || pathname.startsWith("/workspace/")) {
    const section = pathname.replace(/^\/workspace\/?/, "").trim() || "home";
    const redirectUrl = buildRedirectUrl(request, section);
    if (redirectUrl) {
      return NextResponse.redirect(redirectUrl);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/workspace/:path*", "/workspace"],
};
