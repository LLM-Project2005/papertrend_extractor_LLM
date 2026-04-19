import { redirect } from "next/navigation";

export default function ProjectWorkspaceIndexPage({
  params,
}: {
  params: { organizationId: string; projectSlug: string };
}) {
  redirect(
    `/organizations/${encodeURIComponent(params.organizationId)}/projects/${encodeURIComponent(params.projectSlug)}/workspace/home`
  );
}
