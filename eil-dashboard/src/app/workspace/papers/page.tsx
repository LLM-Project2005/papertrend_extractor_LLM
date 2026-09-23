import { redirect } from "next/navigation";

/**
 * Legacy URL. The papers view now lives at /workspace/library.
 *
 * This used to be `redirect("/workspace/library")` with no query handling, which
 * silently dropped `?paperId=`. Every research-chat citation and every "Open
 * paper" link pointed here, so clicking a citation landed the reader on a file
 * list with nothing opened - the one action that proves an answer is not
 * invented. The links now address /workspace/library directly; this keeps older
 * links and bookmarks working by carrying their parameters across.
 */
export default function WorkspacePapersPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value) && value.length > 0) query.set(key, value[0]);
  }
  const suffix = query.toString();
  redirect(suffix ? `/workspace/library?${suffix}` : "/workspace/library");
}
