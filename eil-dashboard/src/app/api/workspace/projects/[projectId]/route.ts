import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { deleteRepository, RepositoryDeleteRefused } from "@/lib/cloudsql/delete-repository";
import { removeStoredFiles } from "@/lib/stored-file-cleanup";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";

/** The reader types the repository's name, as the dialog asks, before it goes. */
const DeleteSchema = z.object({ confirmName: z.string().max(200) });

/**
 * Deletes a repository and everything in it for good (delete-repository.ts).
 * Only the signed-in owner's repository, and only when the body repeats its
 * name, so a stray request cannot delete one.
 */
export async function DELETE(request: Request, context: { params: Promise<{ projectId: string }> }) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (getDatabaseProvider() !== "cloud-sql") {
    return NextResponse.json({ error: "Deleting a repository needs the Cloud SQL workspace." }, { status: 501 });
  }

  const { projectId } = await context.params;
  if (!z.string().uuid().safeParse(projectId).success) {
    return NextResponse.json({ error: "That repository was not found." }, { status: 404 });
  }
  const parsed = DeleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Type the repository's name to delete it." }, { status: 400 });
  }

  try {
    const result = await deleteRepository(user.id, projectId, parsed.data.confirmName);
    await removeStoredFiles(result.orphanedObjects, "repository delete");
    return NextResponse.json({ deleted: true, papers: result.deletedRuns });
  } catch (error) {
    if (error instanceof RepositoryDeleteRefused) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[repository] delete failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "The repository could not be deleted. Nothing was removed; try again." },
      { status: 500 }
    );
  }
}
