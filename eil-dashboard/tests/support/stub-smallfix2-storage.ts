/*
 * @google-cloud/storage for tests of src/lib/gcs-signed-urls.ts as written: no
 * credentials and no requests. The objects storage holds are
 * globalThis.__smallfix2Objects ("bucket/object" to its size and type), and
 * every call the app makes is recorded in globalThis.__smallfix2StorageCalls.
 */
declare global {
  // eslint-disable-next-line no-var
  var __smallfix2Objects: Record<string, { size: number; contentType: string }> | undefined;
  // eslint-disable-next-line no-var
  var __smallfix2StorageCalls: Array<{ op: string; bucket: string; object?: string; options?: Record<string, unknown> }> | undefined;
}

const record = (op: string, bucket: string, object?: string, options?: Record<string, unknown>) =>
  void (globalThis.__smallfix2StorageCalls ??= []).push({ op, bucket, ...(object === undefined ? {} : { object }), ...(options ? { options } : {}) });
const objects = () => (globalThis.__smallfix2Objects ??= {});

function globPattern(glob: string): RegExp {
  const source = glob
    .split("**")
    .map((part) => part.split("*").map((piece) => piece.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*"))
    .join(".*");
  return new RegExp(`^${source}$`);
}

function file(bucket: string, name: string) {
  return {
    name,
    async getMetadata() {
      record("getMetadata", bucket, name);
      const stored = objects()[`${bucket}/${name}`];
      if (!stored) throw Object.assign(new Error("No such object"), { code: 404 });
      return [{ size: String(stored.size), contentType: stored.contentType }];
    },
    async exists() {
      record("exists", bucket, name);
      return [Boolean(objects()[`${bucket}/${name}`])];
    },
    async delete(options?: Record<string, unknown>) {
      record("delete", bucket, name, options);
      delete objects()[`${bucket}/${name}`];
    },
    async getSignedUrl(options: Record<string, unknown>) {
      record("getSignedUrl", bucket, name, options);
      return [`https://storage.test/${bucket}/${name}?action=${String(options.action)}`];
    },
  };
}

export class Storage {
  bucket(bucket: string) {
    return {
      file: (name: string) => file(bucket, name),
      async getFiles(options: { matchGlob?: string } = {}) {
        record("getFiles", bucket, undefined, options);
        const pattern = globPattern(options.matchGlob ?? "**");
        return [
          Object.keys(objects())
            .filter((key) => key.startsWith(`${bucket}/`) && pattern.test(key.slice(bucket.length + 1)))
            .map((key) => file(bucket, key.slice(bucket.length + 1))),
        ];
      },
    };
  }
}
