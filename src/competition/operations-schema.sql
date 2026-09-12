-- Operations-owned additive schema fragment. Parent migration 0002 copies this
-- after the base competition tables exist.
CREATE TABLE competition_candidate_snapshots (
  id uuid PRIMARY KEY,
  round_id uuid NOT NULL UNIQUE REFERENCES competition_rounds(id),
  standings jsonb NOT NULL,
  source_digest text NOT NULL CHECK (length(source_digest) = 64),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(standings) = 'array')
);

CREATE TABLE competition_final_results (
  id uuid PRIMARY KEY,
  round_id uuid NOT NULL UNIQUE REFERENCES competition_rounds(id),
  candidate_snapshot_id uuid NOT NULL UNIQUE REFERENCES competition_candidate_snapshots(id),
  standings jsonb NOT NULL,
  review jsonb NOT NULL,
  approved_by text NOT NULL,
  approved_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(standings) = 'array'),
  CHECK (jsonb_typeof(review) = 'object')
);

CREATE TABLE competition_award_claims (
  id uuid PRIMARY KEY,
  final_result_id uuid NOT NULL REFERENCES competition_final_results(id),
  round_id uuid NOT NULL REFERENCES competition_rounds(id),
  member_id uuid NOT NULL REFERENCES account_members(id),
  final_rank integer NOT NULL CHECK (final_rank > 0),
  award_key text NOT NULL,
  status text NOT NULL DEFAULT 'unclaimed'
    CHECK (status IN ('unclaimed', 'claimed', 'fulfilled', 'void')),
  private_proof jsonb,
  claim_proof_digest text CHECK (claim_proof_digest IS NULL OR length(claim_proof_digest) = 64),
  claim_idempotency_key text,
  claimed_at timestamptz,
  fulfillment_key text UNIQUE,
  fulfilled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, member_id, award_key),
  UNIQUE (id, member_id),
  CHECK ((status = 'unclaimed' AND private_proof IS NULL AND claim_proof_digest IS NULL AND claimed_at IS NULL)
      OR (status IN ('claimed', 'fulfilled') AND private_proof IS NOT NULL AND claim_proof_digest IS NOT NULL AND claimed_at IS NOT NULL)
      OR status = 'void')
);

CREATE TABLE competition_operation_audit (
  id uuid PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES competition_rounds(id),
  operation text NOT NULL,
  actor text NOT NULL,
  idempotency_key text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (round_id, operation, idempotency_key)
);

-- Candidate and final rows are application-immutable; database write-role
-- permissions should also deny UPDATE/DELETE in deployed environments.
CREATE TRIGGER competition_candidate_snapshots_immutable
  BEFORE UPDATE OR DELETE ON competition_candidate_snapshots
  FOR EACH ROW EXECUTE FUNCTION competition_immutable_record();
CREATE TRIGGER competition_candidate_snapshots_no_truncate
  BEFORE TRUNCATE ON competition_candidate_snapshots
  FOR EACH STATEMENT EXECUTE FUNCTION competition_immutable_record();
CREATE TRIGGER competition_final_results_immutable
  BEFORE UPDATE OR DELETE ON competition_final_results
  FOR EACH ROW EXECUTE FUNCTION competition_immutable_record();
CREATE TRIGGER competition_final_results_no_truncate
  BEFORE TRUNCATE ON competition_final_results
  FOR EACH STATEMENT EXECUTE FUNCTION competition_immutable_record();
CREATE TRIGGER competition_operation_audit_immutable
  BEFORE UPDATE OR DELETE ON competition_operation_audit
  FOR EACH ROW EXECUTE FUNCTION competition_immutable_record();
CREATE TRIGGER competition_operation_audit_no_truncate
  BEFORE TRUNCATE ON competition_operation_audit
  FOR EACH STATEMENT EXECUTE FUNCTION competition_immutable_record();
