import { deleteGcsObject } from "@/lib/gcs-signed-urls";

/**
 * Removes stored files after the database deletion that freed them has
 * committed. Storage is not part of that transaction: a file that will not
 * delete is logged and left, rather than undoing the deletion the reader asked
 * for. Used by Trash, by deleting a repository, and by deleting an account.
 */
export async function removeStoredFiles(paths: string[], reason: string): Promise<void> {
  await Promise.all(
    paths.map((path) =>
      deleteGcsObject(path).catch((error) => {
        console.error(`[storage] stored file was not removed after ${reason}`, {
          path,
          message: error instanceof Error ? error.message : String(error),
        });
      })
    )
  );
}
