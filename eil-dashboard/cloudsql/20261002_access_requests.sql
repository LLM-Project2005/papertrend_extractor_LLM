-- Access requests: while Papertrend is invite-only, someone without a code can
-- ask for one from the public site (docs/32, 4.1; audit AUTH-3).
--
-- A request holds what the person typed: name, email, affiliation and how they
-- would use Papertrend. An admin answers it from Settings by making an invite
-- code bound to that email, or by declining it. One open request is kept per
-- email: asking again updates it rather than adding another.
--
-- Requests are personal data from people who have no account, so they are not
-- kept forever: the application deletes any request older than 180 days
-- (ACCESS_REQUEST_RETENTION_DAYS), which is why it may delete here, and the
-- privacy policy says so.

BEGIN;

CREATE TABLE IF NOT EXISTS public.access_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  email           TEXT NOT NULL CHECK (email = lower(email) AND char_length(email) BETWEEN 3 AND 254),
  affiliation     TEXT NOT NULL CHECK (char_length(affiliation) BETWEEN 1 AND 200),
  intended_use    TEXT NOT NULL CHECK (char_length(intended_use) BETWEEN 1 AND 1000),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'invited', 'declined')),
  -- Not a foreign key: invite_codes belongs to another role, and the app's
  -- role may not reference it. Codes are never deleted (no DELETE grant), so
  -- the id cannot dangle.
  invite_code_id  UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ,
  reviewed_by     UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_access_requests_open_email
  ON public.access_requests(email) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_access_requests_created
  ON public.access_requests(created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.access_requests TO papertrend_app;

INSERT INTO public.schema_migrations (name) VALUES ('20261002_access_requests.sql')
ON CONFLICT (name) DO NOTHING;

COMMIT;
