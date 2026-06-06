import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/server-env";
import {
  GuardError,
  assertLoginRateLimit,
  normalizeEmail,
  validateSafeReturnTo,
} from "@/lib/security-guards";

export const runtime = "nodejs";

const PasswordSignupSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(256),
  fullName: z.string().max(120).optional(),
  returnTo: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  try {
    const parsed = PasswordSignupSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a valid email and password." }, { status: 400 });
    }

    const email = normalizeEmail(parsed.data.email);
    await assertLoginRateLimit(request, email);

    const supabaseUrl = getSupabaseUrl();
    const supabaseAnonKey = getSupabaseAnonKey();
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json({ error: "Password auth is not configured." }, { status: 500 });
    }

    const origin = new URL(request.url).origin;
    const returnTo = validateSafeReturnTo(parsed.data.returnTo);
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.auth.signUp({
      email,
      password: parsed.data.password,
      options: {
        emailRedirectTo: `${origin}${returnTo}`,
        data: {
          full_name: parsed.data.fullName?.trim() || undefined,
        },
      },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ user: data.user, session: data.session });
  } catch (error) {
    if (error instanceof GuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Password sign-up failed." }, { status: 500 });
  }
}
