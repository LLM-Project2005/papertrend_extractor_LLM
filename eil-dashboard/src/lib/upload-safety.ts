import { createHash } from "crypto";
import { getMaxUploadBytes } from "@/lib/server-env";

export const MAX_FILES_PER_BATCH = 50;

export type UploadMetadata = {
  name: string;
  size: number;
  type?: string | null;
};

export function sanitizeStorageFileName(fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return safeName || "paper.pdf";
}

export function validatePdfUploadMetadata(file: UploadMetadata): string | null {
  const name = String(file.name ?? "").trim();
  const lowerName = name.toLowerCase();
  const maxBytes = getMaxUploadBytes();
  if (!name) {
    return "A file name is required.";
  }
  if (!lowerName.endsWith(".pdf")) {
    return `Only PDF uploads are supported. Invalid file: ${name}`;
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return `The PDF appears to be empty: ${name}`;
  }
  if (file.size > maxBytes) {
    return `The PDF is too large: ${name}. Maximum size is ${Math.round(maxBytes / 1024 / 1024)} MB.`;
  }
  const mimeType = String(file.type ?? "").toLowerCase();
  if (mimeType && mimeType !== "application/pdf" && mimeType !== "application/octet-stream") {
    return `The upload MIME type is not allowed for ${name}.`;
  }
  return null;
}

export function hasPdfMagic(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

export function sha256Buffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}
