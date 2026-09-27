/*
 * Who may be given a Papertrend account, and what to tell those who may not.
 *
 * An account is created, or an existing one reused, from the email address a
 * sign-in carries. Reusing an account by email is only safe when that email is
 * verified: otherwise anyone could sign up with someone else's address and be
 * handed their papers. So:
 *
 *  - a verified email (Google, or a confirmed email and password) creates an
 *    account, or joins the existing account with that email;
 *  - Facebook gives Firebase no verified flag, so a Facebook sign-in creates a
 *    new account only when no account uses that email yet, and never joins one;
 *  - an email and password sign-in waits until its address is confirmed.
 */

export type SignInProvider = "password" | "google.com" | "facebook.com" | string;

export function signInProviderOf(claims: Record<string, unknown>): SignInProvider | null {
  const firebase = claims.firebase;
  if (!firebase || typeof firebase !== "object") return null;
  const provider = (firebase as { sign_in_provider?: unknown }).sign_in_provider;
  return typeof provider === "string" ? provider : null;
}

export function isEmailVerified(claims: Record<string, unknown>): boolean {
  return claims.email_verified === true;
}

/** A new account may be created for this sign-in, even without a verified email. */
export function mayCreateUnverifiedAccount(claims: Record<string, unknown>): boolean {
  return signInProviderOf(claims) === "facebook.com";
}

export type UnlinkedReason = "email_unverified" | "email_in_use" | "not_linked";

/** Why a signed-in identity has no account, in words the sign-in page can show. */
export function unlinkedReason(claims: Record<string, unknown>, email: string | null): {
  code: UnlinkedReason;
  message: string;
} {
  const provider = signInProviderOf(claims);
  if (!isEmailVerified(claims) && provider === "password") {
    return {
      code: "email_unverified",
      message: `Confirm your email address first. We sent a link to ${email ?? "your address"}; open it, then choose “I’ve confirmed it”.`,
    };
  }
  if (!isEmailVerified(claims) && mayCreateUnverifiedAccount(claims)) {
    return {
      code: "email_in_use",
      message:
        "A Papertrend account already uses this email address. Sign in with Google, or with your email and password, instead.",
    };
  }
  return {
    code: "not_linked",
    message: "This sign-in is not linked to a Papertrend account yet.",
  };
}
