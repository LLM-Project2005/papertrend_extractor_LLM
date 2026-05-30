import { redirect } from "next/navigation";

export default function NewOrganizationRedirectPage() {
  redirect("/workspaces/new");
}
