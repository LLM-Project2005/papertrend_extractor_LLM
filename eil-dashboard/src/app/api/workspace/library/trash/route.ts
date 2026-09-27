import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { permanentlyDeleteTrashedRuns } from "@/lib/cloudsql/permanent-delete";
import { deleteGcsObject } from "@/lib/gcs-signed-urls";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";

const DeleteSchema = z.union([
  z.object({ runIds: z.array(z.string().uuid()).min(1).max(200) }),
  z.object({ all: z.literal(true) }),
]);

/**
 * Permanently deletes papers that are in Trash: one or more by id, or all of
 * them ("Empty Trash"). Only the signed-in owner's runs, and only runs already
 * in Trash, can be deleted. See permanent-delete.ts for what is removed.
 */
export async function DELETE(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (getDatabaseProvider() !== "cloud-sql") {
    return NextResponse.json({ error: "Permanent deletion needs the Cloud SQL workspace." }, { status: 501 });
  }

  const parsed = DeleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose the papers to delete." }, { status: 400 });
  }

  try {
    const result = await permanentlyDeleteTrashedRuns(user.id, "all" in parsed.data ? "all" : parsed.data.runIds);
    // Storage is not part of the transaction: a file that will not delete is
    // logged and left, rather than undoing the deletion the reader asked for.
    await Promise.all(
      result.orphanedObjects.map((path) =>
        deleteGcsObject(path).catch((error) => {
          console.error("[library] stored file was not removed after permanent delete", {
            path,
            message: error instanceof Error ? error.message : String(error),
          });
        })
      )
    );
    return NextResponse.json({ deleted: result.deletedRunIds.length, runIds: result.deletedRunIds });
  } catch (error) {
    console.error("[library] permanent delete failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "The papers could not be deleted. Nothing was removed; try again." },
      { status: 500 }
    );
  }
}
