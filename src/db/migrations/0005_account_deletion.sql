CREATE TABLE account_deletion_receipts (
  request_id uuid PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL,
  member_id uuid, manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(issuer,subject)
);
--> statement-breakpoint
CREATE FUNCTION aegyo_reject_deleted_member() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.issuer||':'||NEW.subject));
  IF EXISTS(SELECT 1 FROM account_deletion_receipts WHERE issuer=NEW.issuer AND subject=NEW.subject) THEN
    RAISE EXCEPTION 'account_deleted';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER aegyo_reject_deleted_member BEFORE INSERT OR UPDATE ON account_members
FOR EACH ROW EXECUTE FUNCTION aegyo_reject_deleted_member();
--> statement-breakpoint
-- Only identity references covered by a committed/in-transaction deletion receipt can be redacted.
CREATE FUNCTION aegyo_redact_deleted_competitors(value jsonb) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE item record; result jsonb; cleaned jsonb;
BEGIN
  IF jsonb_typeof(value)='string' AND EXISTS
    (SELECT 1 FROM account_deletion_receipts WHERE member_id::text=value#>>'{}') THEN RETURN NULL; END IF;
  IF jsonb_typeof(value)='object' THEN
    IF EXISTS(SELECT 1 FROM account_deletion_receipts WHERE member_id::text IN (value->>'memberId',value->>'member_id')) THEN RETURN NULL; END IF;
    result='{}'::jsonb;
    FOR item IN SELECT * FROM jsonb_each(value) LOOP
      cleaned=aegyo_redact_deleted_competitors(item.value);
      IF cleaned IS NOT NULL THEN result=result||jsonb_build_object(item.key,cleaned); END IF;
    END LOOP;
    RETURN result;
  ELSIF jsonb_typeof(value)='array' THEN
    result='[]'::jsonb;
    FOR item IN SELECT * FROM jsonb_array_elements(value) LOOP
      cleaned=aegyo_redact_deleted_competitors(item.value);
      IF cleaned IS NOT NULL THEN result=result||jsonb_build_array(cleaned); END IF;
    END LOOP;
    RETURN result;
  END IF;
  RETURN value;
END $$;
--> statement-breakpoint
-- Preserve the immutable-record rule except for exact, receipt-backed removal of deleted competitors.
CREATE OR REPLACE FUNCTION competition_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_record jsonb; new_record jsonb; field text; allowed text[];
BEGIN
  IF TG_OP='DELETE' AND TG_TABLE_NAME='competition_ledger' THEN
    IF EXISTS(SELECT 1 FROM account_deletion_receipts WHERE member_id=(to_jsonb(OLD)->>'member_id')::uuid) THEN RETURN OLD; END IF;
  END IF;
  IF TG_OP='UPDATE' THEN
    allowed=CASE TG_TABLE_NAME
      WHEN 'competition_candidate_snapshots' THEN ARRAY['standings','game_high_scores']
      WHEN 'competition_final_results' THEN ARRAY['standings','review']
      WHEN 'competition_operation_audit' THEN ARRAY['payload'] ELSE ARRAY[]::text[] END;
    old_record=to_jsonb(OLD); new_record=to_jsonb(NEW);
    IF array_length(allowed,1)>0 AND old_record-allowed=new_record-allowed THEN
      FOREACH field IN ARRAY allowed LOOP
        IF new_record->field IS DISTINCT FROM COALESCE(aegyo_redact_deleted_competitors(old_record->field),'null'::jsonb) THEN
          RAISE EXCEPTION 'competition_record_immutable';
        END IF;
      END LOOP;
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'competition_record_immutable';
END $$;
