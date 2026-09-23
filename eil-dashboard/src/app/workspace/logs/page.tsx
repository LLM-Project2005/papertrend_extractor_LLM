import { redirect } from "next/navigation";

/**
 * Legacy URL. There was an "Analysis History" page here: a list of past runs
 * with a "remove from history" action. It was taken out because it pulled
 * attention away from the papers themselves, and everything it showed is already
 * where a researcher looks for it - each file's status, failures included, is on
 * the file in the library, and recent failures surface on the repository home.
 *
 * Kept as a redirect, like the other retired routes, so an old link lands
 * somewhere useful instead of on a 404.
 */
export default function WorkspaceLogsPage() {
  redirect("/workspace/library");
}
