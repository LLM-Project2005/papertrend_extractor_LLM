-- Invite codes: while Papertrend is closed, a new account needs one.
--
-- Only a SHA-256 hash of each code is stored; the code is shown once to the
-- admin who made it. Existing accounts are not affected: they already have an
-- auth_identity_mappings row and never reach the invite check.
--
-- The application role can read, create and update codes (to count a use or
-- revoke one), and record redemptions. It cannot delete either, so the record
-- of who was invited, and by which code, stays whole.

BEGIN;

CREATE TABLE IF NOT EXISTS public.invite_codes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash     TEXT NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  label         TEXT NOT NULL DEFAULT '' CHECK (char_length(label) <= 80),
  bound_email   TEXT CHECK (bound_email IS NULL OR (bound_email = lower(bound_email) AND char_length(bound_email) <= 254)),
  max_uses      INTEGER NOT NULL DEFAULT 1 CHECK (max_uses BETWEEN 1 AND 50),
  use_count     INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0 AND use_count <= max_uses),
  created_by    UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ,
  last_used_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.invite_code_redemptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_code_id  UUID NOT NULL REFERENCES public.invite_codes(id),
  owner_user_id   UUID NOT NULL UNIQUE REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  email           TEXT,
  redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invite_code_redemptions_code
  ON public.invite_code_redemptions(invite_code_id);

GRANT SELECT, INSERT, UPDATE ON TABLE public.invite_codes TO papertrend_app;
GRANT SELECT, INSERT ON TABLE public.invite_code_redemptions TO papertrend_app;

COMMIT;
