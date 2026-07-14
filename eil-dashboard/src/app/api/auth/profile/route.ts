import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedIdentityFromRequest, identityToLegacyUser } from "@/lib/auth/adapter";
import { getProfileRepository } from "@/lib/profile-repository";

export const runtime = "nodejs";

const ProfileUpdateSchema = z.object({
  full_name: z.string().trim().max(120).nullable().optional(),
  avatar_url: z.string().trim().max(2_000).nullable().optional(),
  workspace_profile: z.record(z.string(), z.unknown()).optional(),
});

async function getOwner(request: Request) {
  let identity;
  try {
    identity = await getAuthenticatedIdentityFromRequest(request, {
      timeoutMs: 8_000,
      throwOnConfiguration: true,
    });
  } catch (error) {
    console.error("Profile authentication failed unexpectedly.", {
      message: error instanceof Error ? error.message : "Unknown authentication error",
    });
    return {
      user: null,
      error: "Authentication service is temporarily unavailable.",
      status: 503,
    };
  }
  if (!identity) {
    return { user: null, error: "Authentication required.", status: 401 };
  }

  if (identity.mappingStatus === "lookup_failed") {
    return {
      user: null,
      error: "The Firebase owner mapping service is temporarily unavailable.",
      status: 503,
    };
  }

  const user = identityToLegacyUser(identity);
  if (!user) {
    return {
      user: null,
      error: "This Firebase account is not linked to a Papertrend owner account yet.",
      status: 403,
    };
  }

  return { user, error: null, status: 200 };
}

export async function GET(request: Request) {
  const owner = await getOwner(request);
  const user = owner.user;
  if (!user) {
    return NextResponse.json({ error: owner.error }, { status: owner.status });
  }

  let result;
  try {
    result = await getProfileRepository().get(user.id);
  } catch (error) {
    console.error("Profile storage lookup failed unexpectedly.", {
      message: error instanceof Error ? error.message : "Unknown profile lookup error",
    });
    return NextResponse.json(
      { error: "Profile service is temporarily unavailable." },
      { status: 503 }
    );
  }

  if (!result) {
    return NextResponse.json({ error: "The authenticated account is not linked to Papertrend." }, { status: 403 });
  }

  return NextResponse.json({ ownerUserId: user.id, profile: result });
}

export async function PATCH(request: Request) {
  const owner = await getOwner(request);
  const user = owner.user;
  if (!user) {
    return NextResponse.json({ error: owner.error }, { status: owner.status });
  }

  const parsed = ProfileUpdateSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return NextResponse.json({ error: "No valid profile changes were provided." }, { status: 400 });
  }

  let result;
  try {
    result = await getProfileRepository().update(user.id, parsed.data);
  } catch (error) {
    console.error("Profile storage update failed unexpectedly.", {
      message: error instanceof Error ? error.message : "Unknown profile update error",
    });
    return NextResponse.json(
      { error: "Profile service is temporarily unavailable." },
      { status: 503 }
    );
  }

  if (!result) {
    return NextResponse.json({ error: "The authenticated account is not linked to Papertrend." }, { status: 403 });
  }

  return NextResponse.json({ ownerUserId: user.id, profile: result });
}
