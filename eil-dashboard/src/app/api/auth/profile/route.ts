import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedUserFromRequest } from "@/lib/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const ProfileUpdateSchema = z.object({
  full_name: z.string().trim().max(120).nullable().optional(),
  avatar_url: z.string().trim().max(2_000).nullable().optional(),
  workspace_profile: z.record(z.string(), z.unknown()).optional(),
});

async function getOwner(request: Request) {
  return getAuthenticatedUserFromRequest(request, { timeoutMs: 8_000 });
}

export async function GET(request: Request) {
  const user = await getOwner(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not load the user profile." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "The authenticated account is not linked to Papertrend." }, { status: 403 });
  }

  return NextResponse.json({ ownerUserId: user.id, profile: data });
}

export async function PATCH(request: Request) {
  const user = await getOwner(request);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const parsed = ProfileUpdateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "No valid profile changes were provided." }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("user_profiles")
    .update(parsed.data)
    .eq("id", user.id)
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Could not save the user profile." }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "The authenticated account is not linked to Papertrend." }, { status: 403 });
  }

  return NextResponse.json({ ownerUserId: user.id, profile: data });
}
