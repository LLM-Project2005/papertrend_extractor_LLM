import { redirect } from "next/navigation";

export default function OrganizationProjectsRedirectPage({
  params,
}: {
  params: { organizationId: string };
}) {
  redirect(`/workspaces/${params.organizationId}/projects`);
}
