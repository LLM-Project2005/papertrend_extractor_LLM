-- Phase 4B transition mapping for Firebase identities.
--
-- This table is server-only. The Vercel API verifies the Firebase ID token,
-- then looks up the exact Firebase UID here before resolving Papertrend data.
-- Do not allow browser clients to insert, update, or select these rows.

CREATE TABLE IF NOT EXISTS public.auth_identity_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL CHECK (provider IN ('supabase', 'firebase')),
  external_subject  TEXT NOT NULL,
  email             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider, external_subject),
  UNIQUE (provider, owner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_auth_identity_mappings_owner
  ON public.auth_identity_mappings(owner_user_id);

CREATE INDEX IF NOT EXISTS idx_auth_identity_mappings_provider_subject
  ON public.auth_identity_mappings(provider, external_subject);

ALTER TABLE public.auth_identity_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auth_identity_mappings FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.prevent_auth_identity_mapping_key_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.owner_user_id IS DISTINCT FROM NEW.owner_user_id
     OR OLD.provider IS DISTINCT FROM NEW.provider
     OR OLD.external_subject IS DISTINCT FROM NEW.external_subject THEN
    RAISE EXCEPTION 'auth identity mapping keys are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS auth_identity_mapping_key_guard
  ON public.auth_identity_mappings;
CREATE TRIGGER auth_identity_mapping_key_guard
BEFORE UPDATE ON public.auth_identity_mappings
FOR EACH ROW
EXECUTE FUNCTION public.prevent_auth_identity_mapping_key_change();

-- There is intentionally no authenticated or anon policy. The service-role
-- backend is the only actor allowed to read or write this transition table.
