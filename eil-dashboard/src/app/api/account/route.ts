import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { clearVerifiedIdentities, deleteFirebaseSignIn } from "@/lib/auth/adapter";
import { AccountDeleteRefused, deleteAccount } from "@/lib/cloudsql/delete-account";
import { removeStoredFiles } from "@/lib/stored-file-cleanup";
import { getDatabaseProvider } from "@/lib/server-env";

export const runtime = "nodejs";

/** The reader types their email, as the dialog asks, before the account goes. */
const DeleteSchema = z.object({ confirmEmail: z.string().max(320) });

/**
 * Deletes the signed-in account and everything it owns (delete-account.ts),
 * then its stored files and its Firebase sign-in. The data goes in one
 * transaction first, so a failure there leaves the account whole; a file or
 * sign-in that will not delete afterwards is logged, not undone.
 */
export async function DELETE(request: Request) {
  const user = await getAuthenticatedUserFromRequest(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (getDatabaseProvider() !== "cloud-sql") {
    return NextResponse.json({ error: "Deleting an account needs the Cloud SQL workspace." }, { status: 501 });
  }
  const parsed = DeleteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Type your email to delete your account." }, { status: 400 });
  }

  let result;
  try {
    result = await deleteAccount(user.id, parsed.data.confirmEmail);
  } catch (error) {
    if (error instanceof AccountDeleteRefused) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("[account] delete failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "Your account could not be deleted. Nothing was removed; try again." },
      { status: 500 }
    );
  }

  // The token that asked is still valid for a minute; it must not find the account.
  clearVerifiedIdentities();
  await removeStoredFiles(result.orphanedObjects, "account delete");
  await Promise.all(
    result.firebaseUids.map((uid) =>
      deleteFirebaseSignIn(uid).catch((error) => {
        console.error("[account] Firebase sign-in was not removed after account delete", {
          message: error instanceof Error ? error.message : String(error),
        });
      })
    )
  );
  return NextResponse.json({ deleted: true });
}
