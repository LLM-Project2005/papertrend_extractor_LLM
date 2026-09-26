import { redirect } from "next/navigation";

// The profile page became the Profile section of Settings, next to sign-in and
// appearance. The URL stays so an old link or bookmark still lands there.
export default function WorkspaceProfilePage() {
  redirect("/workspace/settings?section=profile");
}
