-- Local proof migration; install only after Better Auth's empty-database schema.
-- These functions run with the caller's privileges, not SECURITY DEFINER.
CREATE FUNCTION public.aegyo_credential_changed() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE changed_at timestamptz;
BEGIN
  IF OLD."providerId" = 'credential' OR NEW."providerId" = 'credential' THEN
    IF NEW."userId" IS DISTINCT FROM OLD."userId" OR
       NEW."accountId" IS DISTINCT FROM OLD."accountId" OR
       NEW."providerId" IS DISTINCT FROM OLD."providerId" THEN
      RAISE EXCEPTION 'credential_owner_changed';
    END IF;
  END IF;
  IF OLD."providerId" = 'credential' AND
     NEW.password IS DISTINCT FROM OLD.password THEN
    PERFORM 1 FROM public."user" WHERE id = NEW."userId" FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'credential_owner_missing'; END IF;
    changed_at := date_trunc('milliseconds', clock_timestamp());
    UPDATE public."user"
      SET "credentialVersion" = "credentialVersion" + 1,
          "passwordChangedAt" = GREATEST("passwordChangedAt", changed_at),
          "updatedAt" = changed_at
      WHERE id = NEW."userId";
    IF NOT FOUND THEN RAISE EXCEPTION 'credential_owner_missing'; END IF;
    DELETE FROM public."session" WHERE "userId" = NEW."userId";
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER aegyo_credential_changed
AFTER UPDATE ON public."account"
FOR EACH ROW EXECUTE FUNCTION public.aegyo_credential_changed();

CREATE FUNCTION public.aegyo_session_credential_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE current_version integer; is_banned boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."credentialVersion" IS DISTINCT FROM OLD."credentialVersion" OR
       NEW."userId" IS DISTINCT FROM OLD."userId" THEN
      RAISE EXCEPTION 'session_identity_changed';
    END IF;
    -- Do not invert the user/session lock order during ordinary expiry updates.
    RETURN NEW;
  END IF;
  -- Shares the same row lock as credential changes. A reset either removes an
  -- earlier insertion or commits first and makes this insertion fail.
  SELECT "credentialVersion", banned INTO current_version, is_banned
    FROM public."user" WHERE id = NEW."userId" FOR UPDATE;
  IF NOT FOUND OR NEW."credentialVersion" IS DISTINCT FROM current_version OR
     is_banned IS TRUE THEN
    RAISE EXCEPTION 'stale_credential_session' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER aegyo_session_credential_guard
BEFORE INSERT OR UPDATE ON public."session"
FOR EACH ROW EXECUTE FUNCTION public.aegyo_session_credential_guard();
