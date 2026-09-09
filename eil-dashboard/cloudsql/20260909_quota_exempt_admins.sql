BEGIN;

-- Admin accounts remain fully metered for audit and cost visibility, but the
-- application does not enforce member paper or daily AI quotas against them.
UPDATE public.user_profiles
SET role = 'admin', updated_at = now()
WHERE lower(email) IN (
  'testosterone142@gmail.com',
  'p.chantarusorn@gmail.com'
);

DO $$
DECLARE
  quota_exempt_profiles INTEGER;
BEGIN
  SELECT count(*)
  INTO quota_exempt_profiles
  FROM public.user_profiles
  WHERE lower(email) IN (
    'testosterone142@gmail.com',
    'p.chantarusorn@gmail.com'
  )
    AND role = 'admin';

  IF quota_exempt_profiles <> 2 THEN
    RAISE EXCEPTION 'Expected both trusted accounts to exist with the admin role; found %', quota_exempt_profiles;
  END IF;
END $$;

COMMIT;
