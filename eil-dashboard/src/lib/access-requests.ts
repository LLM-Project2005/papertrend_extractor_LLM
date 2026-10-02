import { z } from "zod";
import {
  ACCESS_REQUEST_AFFILIATION_MAX,
  ACCESS_REQUEST_NAME_MAX,
  ACCESS_REQUEST_USE_MAX,
  ACCESS_REQUEST_USE_MIN,
} from "@/lib/access-request-limits";

export * from "@/lib/access-request-limits";

/*
 * Access requests (docs/32, 4.1; audit AUTH-3): while Papertrend is
 * invite-only, someone without a code asks for one from /request-access, and
 * an admin answers from Settings.
 */

/** A request body larger than this is refused before it is parsed. */
export const ACCESS_REQUEST_MAX_BYTES = 8_000;

export type AccessRequestStatus = "pending" | "invited" | "declined";

/** One reply for every accepted request, so asking again reveals nothing about earlier requests. */
export const ACCESS_REQUEST_RECEIVED =
  "Thanks, your request is in. If there's room in the beta, you'll get an invite code by email.";
export const ACCESS_REQUEST_INVALID =
  "Check your details: a name, a valid email, your affiliation, and a sentence or two on how you'd use Papertrend.";

/** The single-line text fields: trimmed, and runs of whitespace (newlines too) folded to one space. */
const line = (max: number) =>
  z
    .string()
    .transform((value) => value.replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1).max(max));

export const AccessRequestSchema = z.object({
  name: line(ACCESS_REQUEST_NAME_MAX),
  email: z.string().trim().toLowerCase().email().max(254),
  affiliation: line(ACCESS_REQUEST_AFFILIATION_MAX),
  intendedUse: z
    .string()
    .transform((value) => value.replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n").trim())
    .pipe(z.string().min(ACCESS_REQUEST_USE_MIN).max(ACCESS_REQUEST_USE_MAX)),
  /** A field people never see: a form that fills it in is a bot's. */
  website: z.string().max(200).optional(),
});

export type AccessRequestInput = Omit<z.infer<typeof AccessRequestSchema>, "website">;

export type ParsedAccessRequest =
  | { kind: "request"; request: AccessRequestInput }
  | { kind: "bot" }
  | { kind: "invalid" };

/** Reads a submitted form. A filled-in hidden field is answered as if it worked, and stored nowhere. */
export function parseAccessRequest(body: unknown): ParsedAccessRequest {
  const parsed = AccessRequestSchema.safeParse(body);
  if (!parsed.success) return { kind: "invalid" };
  if (parsed.data.website?.trim()) return { kind: "bot" };
  const { name, email, affiliation, intendedUse } = parsed.data;
  return { kind: "request", request: { name, email, affiliation, intendedUse } };
}
