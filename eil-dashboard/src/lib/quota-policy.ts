export function isQuotaExemptRole(role: unknown): boolean {
  return role === "admin" || role === "superuser";
}
