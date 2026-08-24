export async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function fingerprintFiles(
  files: File[],
  onProgress?: (completed: number, total: number) => void
): Promise<string[]> {
  const fingerprints: string[] = [];
  for (const [index, file] of files.entries()) {
    fingerprints.push(await sha256File(file));
    onProgress?.(index + 1, files.length);
  }
  return fingerprints;
}
