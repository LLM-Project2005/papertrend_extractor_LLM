import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { getDatabaseProvider } from "@/lib/server-env";
import {
  getBearerTokenFromRequest,
  verifyFirebaseIdentityToken,
} from "@/lib/auth/adapter";

export const runtime = "nodejs";

function sameEmail(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());
}

/**
 * One-time staging link flow. It requires an already authenticated Supabase
 * owner and a separately verified Firebase token for the same email. It is
 * intentionally not usable to choose an arbitrary owner UUID from the client.
 */
export async function POST(request: Request) {
  if (getDatabaseProvider() === "cloud-sql") {
    return NextResponse.json(
      { error: "Legacy Supabase account linking is not available in Cloud SQL mode." },
      { status: 410 }
    );
  }
  const supabaseToken = getBearerTokenFromRequest(request);
  const firebaseToken = request.headers.get("x-firebase-id-token")?.trim() ?? "";
  if (!supabaseToken || !firebaseToken) {
    return NextResponse.json(
      { error: "Both the current Papertrend session and Firebase token are required." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseAdmin();
  const {
    data: { user: supabaseUser },
    error: supabaseError,
  } = await supabase.auth.getUser(supabaseToken);
  if (supabaseError || !supabaseUser) {
    return NextResponse.json({ error: "The current Papertrend session is invalid." }, { status: 401 });
  }

  const firebaseIdentity = await verifyFirebaseIdentityToken(firebaseToken);
  const emailVerified = firebaseIdentity?.claims.email_verified === true;
  if (!firebaseIdentity || !emailVerified || !sameEmail(supabaseUser.email, firebaseIdentity.email)) {
    return NextResponse.json(
      { error: "The Firebase account must be verified and use the same email as the Papertrend account." },
      { status: 403 }
    );
  }

  const { data: existing, error: lookupError } = await supabase
    .from("auth_identity_mappings")
    .select("owner_user_id,email")
    .eq("provider", "firebase")
    .eq("external_subject", firebaseIdentity.subject)
    .maybeSingle();
  if (lookupError) {
    return NextResponse.json({ error: "The identity mapping table is not ready." }, { status: 503 });
  }
  if (existing && existing.owner_user_id !== supabaseUser.id) {
    return NextResponse.json({ error: "This Firebase account is already linked elsewhere." }, { status: 409 });
  }

  const { error: upsertError } = await supabase
    .from("auth_identity_mappings")
    .upsert(
      {
        owner_user_id: supabaseUser.id,
        provider: "firebase",
        external_subject: firebaseIdentity.subject,
        email: firebaseIdentity.email ?? supabaseUser.email,
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "provider,external_subject" }
    );
  if (upsertError) {
    return NextResponse.json({ error: "The Firebase identity could not be linked." }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    provider: "firebase",
    ownerUserId: supabaseUser.id,
    externalSubject: firebaseIdentity.subject,
  });
}
