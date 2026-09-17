-- Explicit owner migration; never run on application startup.
-- SECURITY DEFINER is needed because the application cannot update security columns.
-- Every relation is schema qualified and the application cannot CREATE in public.
CREATE OR REPLACE FUNCTION public.aegyo_credential_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
          "securityVersion" = "securityVersion" + 1,
          "passwordChangedAt" = GREATEST("passwordChangedAt", changed_at),
          "updatedAt" = changed_at
      WHERE id = NEW."userId";
    IF NOT FOUND THEN RAISE EXCEPTION 'credential_owner_missing'; END IF;
    DELETE FROM public."oauthAccessToken" WHERE "userId" = NEW."userId";
    DELETE FROM public."oauthRefreshToken" WHERE "userId" = NEW."userId";
    DELETE FROM public."session" WHERE "userId" = NEW."userId";
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aegyo_credential_changed ON public."account";
CREATE TRIGGER aegyo_credential_changed
AFTER UPDATE ON public."account"
FOR EACH ROW EXECUTE FUNCTION public.aegyo_credential_changed();

CREATE OR REPLACE FUNCTION public.aegyo_session_credential_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE current_version integer; current_security integer; is_banned boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW."credentialVersion" IS DISTINCT FROM OLD."credentialVersion" OR
       NEW."userId" IS DISTINCT FROM OLD."userId" OR
       NEW."securityVersion" IS DISTINCT FROM OLD."securityVersion" THEN
      RAISE EXCEPTION 'session_identity_changed';
    END IF;
    -- Do not invert the user/session lock order during ordinary expiry updates.
    RETURN NEW;
  END IF;
  -- Shares the same row lock as credential changes. A reset either removes an
  -- earlier insertion or commits first and makes this insertion fail.
  SELECT "credentialVersion", "securityVersion", banned INTO current_version, current_security, is_banned
    FROM public."user" WHERE id = NEW."userId" FOR UPDATE;
  IF NOT FOUND OR NEW."credentialVersion" IS DISTINCT FROM current_version OR
     NEW."securityVersion" IS DISTINCT FROM current_security OR
     is_banned IS TRUE THEN
    RAISE EXCEPTION 'stale_credential_session' USING ERRCODE = '40001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS aegyo_session_credential_guard ON public."session";
CREATE TRIGGER aegyo_session_credential_guard
BEFORE INSERT OR UPDATE ON public."session"
FOR EACH ROW EXECUTE FUNCTION public.aegyo_session_credential_guard();

-- Operator-only cutoff, including login races. Runtime gets no EXECUTE privilege.
CREATE OR REPLACE FUNCTION public.aegyo_revoke_user(target_user text, block_login boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE changed_at timestamptz;
BEGIN
  PERFORM 1 FROM public."user" WHERE id=target_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'unknown_member'; END IF;
  changed_at := date_trunc('milliseconds', clock_timestamp());
  UPDATE public."user" SET "securityVersion"="securityVersion"+1,
    "operatorRevokedAt"=GREATEST("operatorRevokedAt", changed_at),
    "updatedAt"=changed_at, banned=CASE WHEN block_login THEN true ELSE banned END
    WHERE id=target_user;
  DELETE FROM public."oauthAccessToken" WHERE "userId"=target_user;
  DELETE FROM public."oauthRefreshToken" WHERE "userId"=target_user;
  DELETE FROM public."session" WHERE "userId"=target_user;
END;
$$;
REVOKE ALL ON FUNCTION public.aegyo_revoke_user(text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aegyo_credential_changed() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aegyo_session_credential_guard() FROM PUBLIC;
