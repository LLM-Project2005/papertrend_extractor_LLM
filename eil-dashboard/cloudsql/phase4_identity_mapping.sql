-- Phase 4: provider-neutral identity mapping for staging Cloud SQL.
-- Additive only. Do not switch the live auth provider by running this file.
-- The backend must verify an external token before creating or reading a map.

CREATE TABLE IF NOT EXISTS public.auth_identity_mappings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
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

DO $$
BEGIN
  ALTER TABLE public.auth_identity_mappings
    ADD CONSTRAINT auth_identity_mappings_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES public.user_profiles(id) ON DELETE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.prevent_auth_identity_key_change()
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
EXECUTE FUNCTION public.prevent_auth_identity_key_change();

-- This table is backend-only during the migration. Do not expose it through
-- browser APIs or attach a public policy. Cloud SQL RLS will be finalized
-- together with the backend auth adapter before any provider cutover.
