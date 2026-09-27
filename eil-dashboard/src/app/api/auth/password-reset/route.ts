import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getAuthProvider, getSupabaseAnonKey, getSupabaseUrl } from "@/lib/server-env";
import {
  GuardError,
  assertLoginRateLimit,
  normalizeEmail,
  validateSafeReturnTo,
} from "@/lib/security-guards";

export const runtime = "nodejs";

const PasswordResetSchema = z.object({
  email: z.string().email().max(320),
  returnTo: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  // These serve the retired Supabase sign-in only. Under Firebase they answer
  // at once, before touching the database, so they cannot be used to fill the
  // rate-limit table or hold connections.
  if (getAuthProvider() !== "supabase") {
    return NextResponse.json({ error: "This sign-in route is retired." }, { status: 410 });
  }
  try {
    const parsed = PasswordResetSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }

    const email = normalizeEmail(parsed.data.email);
    await assertLoginRateLimit(request, email);

    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Password reset is not configured." }, { status: 500 });
    }

    const origin = new URL(request.url).origin;
    const returnTo = validateSafeReturnTo(parsed.data.returnTo, "/login");
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}${returnTo}`,
    });

    return NextResponse.json({
      ok: true,
      message: "If that email can receive password reset mail, a reset link is on the way.",
    });
  } catch (error) {
    if (error instanceof GuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Password reset failed." }, { status: 500 });
  }
}
