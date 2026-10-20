-- Additive schema, installed by a database owner. Runtime never receives general ban/revoke access.
CREATE SCHEMA IF NOT EXISTS account_deletion;
REVOKE ALL ON SCHEMA account_deletion FROM PUBLIC;
CREATE TABLE IF NOT EXISTS account_deletion.jobs (
  id uuid PRIMARY KEY,
  subject text NOT NULL UNIQUE,
  receipt_hash text NOT NULL CHECK (length(receipt_hash)=64),
  status text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','needs_review','completed')),
  manifest jsonb NOT NULL DEFAULT '{}',
  policy_version text NOT NULL DEFAULT '2026-10-20.1',
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE OR REPLACE FUNCTION account_deletion.begin_request(
  target_subject text, session_id text, request_id uuid, receipt_digest text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,account_deletion AS $$
BEGIN
  PERFORM 1 FROM public."user" WHERE id=target_subject FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'deletion_session_required'; END IF;
  -- Recheck under the same user lock used by the credential/session guards.
  PERFORM 1 FROM public."session" s JOIN public."user" u ON u.id=s."userId"
    WHERE s.id=session_id AND s."userId"=target_subject AND s."expiresAt">now()
      AND s."createdAt">now()-interval '15 minutes' AND NOT COALESCE(u.banned,false);
  IF NOT FOUND THEN RAISE EXCEPTION 'deletion_reauthentication_required'; END IF;
  INSERT INTO account_deletion.jobs(id,subject,receipt_hash)
    VALUES(request_id,target_subject,receipt_digest);
  PERFORM public.aegyo_revoke_user(target_subject,true);
  RETURN request_id;
END;
$$;

CREATE OR REPLACE FUNCTION account_deletion.finish_request(request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,account_deletion AS $$
DECLARE job account_deletion.jobs; old_email text; verification_row record;
BEGIN
  SELECT * INTO job FROM account_deletion.jobs WHERE id=request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'deletion_unknown_request'; END IF;
  IF job.status='completed' THEN RETURN; END IF;
  IF (
    job.manifest->'social'->>'status' IN ('completed','no_link','needs_review') AND
    job.manifest->'arcade'->>'status' IN ('completed','no_link','needs_review') AND
    job.manifest->'daebak'->>'status' IN ('completed','no_link','needs_review')
  ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'deletion_incomplete_participants';
  END IF;
  SELECT email INTO old_email FROM public."user" WHERE id=job.subject FOR UPDATE;
  DELETE FROM public."oauthAccessToken" WHERE "userId"=job.subject;
  DELETE FROM public."oauthRefreshToken" WHERE "userId"=job.subject;
  DELETE FROM public."oauthConsent" WHERE "userId"=job.subject;
  DELETE FROM public."session" WHERE "userId"=job.subject;
  DELETE FROM public."account" WHERE "userId"=job.subject;
  -- BetterAuth resets store the exact user id. OAuth codes store JSON userId.
  -- Never substring-match emails or ids belonging to other users.
  DELETE FROM public."verification" WHERE value=job.subject OR identifier=job.subject OR
    (old_email IS NOT NULL AND (lower(identifier)=lower(old_email) OR lower(value)=lower(old_email)));
  FOR verification_row IN SELECT id,value FROM public."verification" WHERE left(ltrim(value),1)='{' LOOP
    BEGIN
      IF verification_row.value::jsonb->>'userId'=job.subject THEN
        DELETE FROM public."verification" WHERE id=verification_row.id;
      END IF;
    EXCEPTION WHEN invalid_text_representation THEN NULL;
    END;
  END LOOP;
  UPDATE public."user" SET name='Deleted account',
    email='deleted-'||request_id::text||'@example.invalid', image=NULL,
    "emailVerified"=false, banned=true, "banReason"='account_deleted', "banExpires"=NULL,
    "updatedAt"=now() WHERE id=job.subject;
  UPDATE account_deletion.jobs SET status=CASE WHEN EXISTS
      (SELECT 1 FROM jsonb_each(job.manifest) p WHERE p.value->>'status'='needs_review')
      THEN 'needs_review' ELSE 'completed' END,
    completed_at=now(),lease_until=NULL,last_error=NULL,
    manifest=manifest||jsonb_build_object('accounts',jsonb_build_object(
      'status','completed','removed',jsonb_build_array('profile','credentials','sessions','oauth_tokens','recovery_tokens'),
      'retained',jsonb_build_array('deletion_tombstone','deletion_receipt')))
    WHERE id=request_id;
END;
$$;
REVOKE ALL ON FUNCTION account_deletion.begin_request(text,text,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION account_deletion.finish_request(uuid) FROM PUBLIC;
