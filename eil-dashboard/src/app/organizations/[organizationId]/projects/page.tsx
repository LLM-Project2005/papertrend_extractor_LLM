import { redirect } from "next/navigation";

export default async function OrganizationProjectsRedirectPage({
  params,
}: {
  params: Promise<{ organizationId: string }>;
}) {
  redirect(`/workspaces/${(await params).organizationId}/projects`);
}
