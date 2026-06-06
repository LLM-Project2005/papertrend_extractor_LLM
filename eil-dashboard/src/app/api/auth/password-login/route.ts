import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/server-env";
import {
  GuardError,
  assertLoginRateLimit,
  normalizeEmail,
} from "@/lib/security-guards";

export const runtime = "nodejs";

const PasswordLoginSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(8).max(256),
});

export async function POST(request: Request) {
  try {
    const parsed = PasswordLoginSchema.safeParse(await request.json().catch(() => ({})));
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

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: parsed.data.password,
    });

    if (error || !data.session) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    return NextResponse.json({ user: data.user, session: data.session });
  } catch (error) {
    if (error instanceof GuardError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "Password sign-in failed." }, { status: 500 });
  }
}
