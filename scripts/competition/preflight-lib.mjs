export class CompetitionPreflightError extends Error {
  constructor(code) {
    super(code);
    this.name = "CompetitionPreflightError";
    this.code = code;
  }
}

export const EXPECTED_MIGRATIONS = [
  {
    tag: "0000_foamy_rogue",
    createdAt: "1784339503850",
    hash: "168f7fabf5f7ef728ac0aa993cea897334e3ffaa22594a3c134f624ecd3bde63",
  },
  {
    tag: "0001_arcade_shared_auth",
    createdAt: "1789165792963",
    hash: "c7d7bc3431ec54cd9a60b76d69885ffe573ae6d2d5ed0fbb46611e9eb3f60a0a",
  },
  {
    tag: "0002_arcade_competition",
    createdAt: "1789239167663",
    hash: "4b0d4e00c6069b49351ce5a1b6f34aeebc094b23b9a186ac8d6f262b032a72d8",
  },
  {
    tag: "0003_monthly_scoring_windows",
    createdAt: "1789670938683",
    hash: "ae2f3d6bab50a9824c13c5e3430acc79a2ed4c87e28c036f74ac265eed373ad1",
  },
  {
    tag: "0004_expand_competition_games",
    createdAt: "1789676286417",
    hash: "12ef5fcbd80d66aeb11ad50e307f57bed33ced8476aa659afd68535b63e353f1",
  },
];

export const EXPECTED_TABLES = [
  "devices",
  "run_attempts",
  "account_members",
  "account_sessions",
  "competition_attempts",
  "competition_award_claims",
  "competition_candidate_snapshots",
  "competition_challenges",
  "competition_daily_best",
  "competition_enrollments",
  "competition_final_results",
  "competition_ledger",
  "competition_operation_audit",
  "competition_profiles",
  "competition_rounds",
  "competition_period_best",
  "competition_period_bonuses",
];

export const EXPECTED_COLUMNS = [
  ["account_sessions", "email_verified", true, "boolean"],
  ["competition_attempts", "score_period_key", true, "text"],
  ["competition_attempts", "security_confirmed", true, "boolean"],
  ["competition_attempts", "trace_hash", false, "text"],
  ["competition_attempts", "trace", false, "jsonb"],
  ["competition_attempts", "receipt", false, "jsonb"],
  ["competition_attempts", "rejection_code", false, "text"],
  ["competition_rounds", "rules", true, "jsonb"],
  ["competition_rounds", "status", true, "text"],
  ["competition_rounds", "opens_at", true, "timestamp with time zone"],
  ["competition_rounds", "closes_at", true, "timestamp with time zone"],
  ["competition_award_claims", "private_proof", false, "jsonb"],
  ["competition_award_claims", "claim_proof_digest", false, "text"],
  ["competition_period_best", "period_key", true, "text"],
  ["competition_period_best", "points", true, "integer"],
  ["competition_period_bonuses", "period_key", true, "text"],
  ["competition_period_bonuses", "points", true, "integer"],
];

export const EXPECTED_CONSTRAINTS = {
  competition_attempt_game:
    "CHECK (game_id = ANY (ARRAY['snake'::text, 'flappy'::text, 'perfect-toss'::text, 'hangman'::text]))",
  competition_attempt_score_period:
    "CHECK (score_period_key ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'::text)",
  competition_attempt_status:
    "CHECK (status = ANY (ARRAY['issued'::text, 'pending'::text, 'verified'::text, 'rejected'::text, 'void'::text]))",
  competition_round_status:
    "CHECK (status = ANY (ARRAY['draft'::text, 'open'::text, 'closing'::text, 'review'::text, 'final'::text]))",
  competition_round_dates: "CHECK (closes_at > opens_at)",
  competition_claim_state:
    "CHECK (status = 'unclaimed'::text AND private_proof IS NULL AND claim_proof_digest IS NULL AND claimed_at IS NULL OR (status = ANY (ARRAY['claimed'::text, 'fulfilled'::text])) AND private_proof IS NOT NULL AND claim_proof_digest IS NOT NULL AND claimed_at IS NOT NULL OR status = 'void'::text)",
  competition_period_best_points: "CHECK (points >= 0 AND points <= 1000)",
  competition_period_bonus_points: "CHECK (points >= 1 AND points <= 1000)",
  competition_attempts_round_id_competition_rounds_id_fk:
    "FOREIGN KEY (round_id) REFERENCES competition_rounds(id) ON DELETE RESTRICT",
  competition_attempts_member_id_account_members_id_fk:
    "FOREIGN KEY (member_id) REFERENCES account_members(id) ON DELETE RESTRICT",
};

export const EXPECTED_INDEXES = {
  competition_attempt_quota: [
    "UNIQUE",
    "round_id",
    "member_id",
    "game_id",
    "day_key",
    "ordinal",
  ],
  competition_attempt_idempotency: [
    "UNIQUE",
    "round_id",
    "member_id",
    "idempotency_key",
  ],
  competition_attempts_pending: ["round_id", "status"],
  competition_award_unique: ["UNIQUE", "round_id", "member_id", "award_key"],
  competition_operation_idempotency: [
    "UNIQUE",
    "round_id",
    "operation",
    "idempotency_key",
  ],
};

export const EXPECTED_TRIGGERS = {
  competition_frozen_rules: "competition_rounds",
  competition_ledger_immutable: "competition_ledger",
  competition_ledger_no_truncate: "competition_ledger",
  competition_evidence_frozen: "competition_attempts",
  competition_candidate_snapshots_immutable: "competition_candidate_snapshots",
  competition_candidate_snapshots_no_truncate:
    "competition_candidate_snapshots",
  competition_final_results_immutable: "competition_final_results",
  competition_final_results_no_truncate: "competition_final_results",
  competition_operation_audit_immutable: "competition_operation_audit",
  competition_operation_audit_no_truncate: "competition_operation_audit",
};

export const EXPECTED_FUNCTIONS = {
  competition_frozen_rules: [
    "OLD.status",
    "draft",
    "NEW.rules",
    "NEW.opens_at",
    "NEW.closes_at",
    "NEW.slug",
  ],
  competition_immutable_record: [
    "RAISE EXCEPTION 'competition_record_immutable'",
  ],
  competition_evidence_frozen: [
    "NEW.score_period_key",
    "OLD.trace_hash",
    "NEW.trace_hash",
    "NEW.received_at",
    "NEW.receipt",
  ],
};

const asString = (value) =>
  value === null || value === undefined ? "" : String(value);

const includesAll = (definition, fragments) => {
  const normalized = asString(definition).toLowerCase();
  return fragments.every((fragment) =>
    normalized.includes(String(fragment).toLowerCase()),
  );
};

function normalizedCheck(definition) {
  return asString(definition)
    .toLowerCase()
    .replaceAll('"', "")
    .replace(/\bpublic\./g, "")
    .replace(/\bcompetition_period_(?:best|bonuses)\./g, "")
    .replace(/\s/g, "");
}

function constraintMatches(definition, expectedDefinition) {
  return normalizedCheck(definition) === normalizedCheck(expectedDefinition);
}

function count(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new CompetitionPreflightError("invalid_aggregate_result");
  return parsed;
}

export function validateDatabaseSelection(expected, confirmed) {
  if (!expected?.trim() || !confirmed?.trim())
    throw new CompetitionPreflightError("database_confirmation_required");
  if (expected !== confirmed)
    throw new CompetitionPreflightError("database_confirmation_mismatch");
  if (/\p{Cc}/u.test(expected))
    throw new CompetitionPreflightError("invalid_database_name");
  return expected;
}

export function assessSchemaProof(proof) {
  const migrationByTime = new Map(
    proof.migrations.map((row) => [
      asString(row.created_at),
      asString(row.hash),
    ]),
  );
  const missingMigrations = [];
  const mismatchedMigrations = [];
  for (const migration of EXPECTED_MIGRATIONS) {
    const hash = migrationByTime.get(migration.createdAt);
    if (hash === undefined) missingMigrations.push(migration.tag);
    else if (hash !== migration.hash) mismatchedMigrations.push(migration.tag);
  }

  const foundTables = new Set(proof.tables.map((row) => row.name));
  const missingTables = EXPECTED_TABLES.filter(
    (name) => !foundTables.has(name),
  );

  const columnByName = new Map(
    proof.columns.map((row) => [`${row.table_name}.${row.column_name}`, row]),
  );
  const missingColumns = [];
  const mismatchedColumns = [];
  for (const [table, column, notNull, dataType] of EXPECTED_COLUMNS) {
    const name = `${table}.${column}`;
    const found = columnByName.get(name);
    if (!found) missingColumns.push(name);
    else if (
      (found.is_nullable === "NO") !== notNull ||
      found.data_type !== dataType
    )
      mismatchedColumns.push(name);
  }

  const constraintByName = new Map(
    proof.constraints.map((row) => [row.name, row]),
  );
  const missingConstraints = [];
  const mismatchedConstraints = [];
  for (const [name, expectedDefinition] of Object.entries(
    EXPECTED_CONSTRAINTS,
  )) {
    const found = constraintByName.get(name);
    if (!found) missingConstraints.push(name);
    else if (
      !found.validated ||
      !constraintMatches(found.definition, expectedDefinition)
    )
      mismatchedConstraints.push(name);
  }

  const indexByName = new Map(proof.indexes.map((row) => [row.name, row]));
  const missingIndexes = [];
  const mismatchedIndexes = [];
  for (const [name, fragments] of Object.entries(EXPECTED_INDEXES)) {
    const found = indexByName.get(name);
    if (!found) missingIndexes.push(name);
    else if (!includesAll(found.definition, fragments))
      mismatchedIndexes.push(name);
  }

  const triggerByName = new Map(proof.triggers.map((row) => [row.name, row]));
  const missingTriggers = [];
  const disabledTriggers = [];
  const mismatchedTriggers = [];
  for (const [name, table] of Object.entries(EXPECTED_TRIGGERS)) {
    const found = triggerByName.get(name);
    if (!found) missingTriggers.push(name);
    else if (!new Set(["O", "A"]).has(found.enabled))
      disabledTriggers.push(name);
    else if (found.table_name !== table) mismatchedTriggers.push(name);
  }

  const functionByName = new Map(proof.functions.map((row) => [row.name, row]));
  const missingFunctions = [];
  const mismatchedFunctions = [];
  for (const [name, fragments] of Object.entries(EXPECTED_FUNCTIONS)) {
    const found = functionByName.get(name);
    if (!found) missingFunctions.push(name);
    else if (!includesAll(found.definition, fragments))
      mismatchedFunctions.push(name);
  }

  const problems = {
    missingMigrations,
    mismatchedMigrations,
    missingTables,
    missingColumns,
    mismatchedColumns,
    missingConstraints,
    mismatchedConstraints,
    missingIndexes,
    mismatchedIndexes,
    missingTriggers,
    disabledTriggers,
    mismatchedTriggers,
    missingFunctions,
    mismatchedFunctions,
  };
  const complete =
    proof.migrationTablePresent &&
    Object.values(problems).every((entries) => entries.length === 0);
  return {
    complete,
    migrationHistory: {
      present: proof.migrationTablePresent,
      expected: EXPECTED_MIGRATIONS.length,
      verified:
        EXPECTED_MIGRATIONS.length -
        missingMigrations.length -
        mismatchedMigrations.length,
      missing: missingMigrations,
      mismatched: mismatchedMigrations,
    },
    objects: {
      expectedTables: EXPECTED_TABLES.length,
      verifiedTables: EXPECTED_TABLES.length - missingTables.length,
      ...problems,
    },
  };
}

function statusCounts(rows, allowed) {
  const result = Object.fromEntries(allowed.map((status) => [status, 0]));
  for (const row of rows) {
    if (!Object.hasOwn(result, row.status))
      throw new CompetitionPreflightError("invalid_aggregate_result");
    result[row.status] = count(row.count);
  }
  return result;
}

function buildHealth(rows) {
  const singleton = rows.health[0];
  const pending = rows.pending[0];
  if (!singleton || !pending)
    throw new CompetitionPreflightError("invalid_aggregate_result");
  return {
    rounds: {
      total: count(singleton.round_total),
      byStatus: statusCounts(rows.roundStatuses, [
        "draft",
        "open",
        "closing",
        "review",
        "final",
      ]),
      upcoming: count(singleton.upcoming_rounds),
      activeWindow: count(singleton.active_window_rounds),
      pastCloseNotFinal: count(singleton.past_close_not_final),
      openOutsideWindow: count(singleton.open_outside_window),
    },
    totals: {
      enrollments: count(singleton.enrollment_count),
      challenges: count(singleton.challenge_count),
      periodBest: count(singleton.period_best_count),
      periodBonuses: count(singleton.period_bonus_count),
      ledgerEntries: count(singleton.ledger_count),
      candidateSnapshots: count(singleton.snapshot_count),
      finalResults: count(singleton.final_result_count),
    },
    attempts: {
      total: count(singleton.attempt_count),
      byStatus: statusCounts(rows.attemptStatuses, [
        "issued",
        "pending",
        "verified",
        "rejected",
        "void",
      ]),
      issuedPastExpiry: count(pending.issued_past_expiry),
      pendingAtLeastFiveMinutes: count(pending.pending_five_minutes),
      pendingAtLeastFifteenMinutes: count(pending.pending_fifteen_minutes),
      oldestPendingSeconds:
        pending.oldest_pending_seconds === null
          ? null
          : count(pending.oldest_pending_seconds),
      rejectedTotal: count(pending.rejected_total),
      rejectedReceivedLast24Hours: count(pending.rejected_received_last_24h),
      rejectedWithoutCode: count(pending.rejected_without_code),
    },
    awards: {
      total: count(singleton.award_count),
      byStatus: statusCounts(rows.awardStatuses, [
        "unclaimed",
        "claimed",
        "fulfilled",
        "void",
      ]),
    },
  };
}

async function inspectSchema(client, migrationTablePresent) {
  const migrations = migrationTablePresent
    ? (
        await client.query(
          `SELECT created_at::text, hash
             FROM drizzle.__drizzle_migrations
            WHERE created_at = ANY($1::bigint[])
            ORDER BY created_at`,
          [EXPECTED_MIGRATIONS.map((migration) => migration.createdAt)],
        )
      ).rows
    : [];
  // A pg Client serializes queries; keep the sequence explicit so this also
  // remains compatible with pg 9's stricter single-query client contract.
  const tables = await client.query(
    `SELECT c.relname AS name
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind IN ('r','p')
            AND c.relname=ANY($1::text[])
          ORDER BY c.relname`,
    [EXPECTED_TABLES],
  );
  const columns = await client.query(
    `SELECT table_name,column_name,is_nullable,data_type
           FROM information_schema.columns
          WHERE table_schema='public' AND table_name=ANY($1::text[])
          ORDER BY table_name,column_name`,
    [EXPECTED_TABLES],
  );
  const constraints = await client.query(
    `SELECT con.conname AS name,con.convalidated AS validated,
                pg_catalog.pg_get_constraintdef(con.oid,true) AS definition
           FROM pg_catalog.pg_constraint con
           JOIN pg_catalog.pg_class c ON c.oid=con.conrelid
           JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND con.conname=ANY($1::text[])
          ORDER BY con.conname`,
    [Object.keys(EXPECTED_CONSTRAINTS)],
  );
  const indexes = await client.query(
    `SELECT indexname AS name,indexdef AS definition
           FROM pg_catalog.pg_indexes
          WHERE schemaname='public' AND indexname=ANY($1::text[])
          ORDER BY indexname`,
    [Object.keys(EXPECTED_INDEXES)],
  );
  const triggers = await client.query(
    `SELECT t.tgname AS name,c.relname AS table_name,t.tgenabled AS enabled
           FROM pg_catalog.pg_trigger t
           JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
           JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND NOT t.tgisinternal
            AND t.tgname=ANY($1::text[])
          ORDER BY t.tgname`,
    [Object.keys(EXPECTED_TRIGGERS)],
  );
  const functions = await client.query(
    `SELECT p.proname AS name,pg_catalog.pg_get_functiondef(p.oid) AS definition
           FROM pg_catalog.pg_proc p
           JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname='public' AND p.proname=ANY($1::text[])
          ORDER BY p.proname`,
    [Object.keys(EXPECTED_FUNCTIONS)],
  );
  return {
    migrationTablePresent,
    migrations,
    tables: tables.rows,
    columns: columns.rows,
    constraints: constraints.rows,
    indexes: indexes.rows,
    triggers: triggers.rows,
    functions: functions.rows,
  };
}

async function inspectHealth(client) {
  const health = await client.query(`
        SELECT
          (SELECT count(*) FROM competition_rounds)::text AS round_total,
          (SELECT count(*) FROM competition_rounds WHERE opens_at>statement_timestamp())::text AS upcoming_rounds,
          (SELECT count(*) FROM competition_rounds WHERE opens_at<=statement_timestamp() AND closes_at>statement_timestamp())::text AS active_window_rounds,
          (SELECT count(*) FROM competition_rounds WHERE closes_at<=statement_timestamp() AND status<>'final')::text AS past_close_not_final,
          (SELECT count(*) FROM competition_rounds WHERE status='open' AND NOT (opens_at<=statement_timestamp() AND closes_at>statement_timestamp()))::text AS open_outside_window,
          (SELECT count(*) FROM competition_enrollments)::text AS enrollment_count,
          (SELECT count(*) FROM competition_challenges)::text AS challenge_count,
          (SELECT count(*) FROM competition_attempts)::text AS attempt_count,
          (SELECT count(*) FROM competition_period_best)::text AS period_best_count,
          (SELECT count(*) FROM competition_period_bonuses)::text AS period_bonus_count,
          (SELECT count(*) FROM competition_ledger)::text AS ledger_count,
          (SELECT count(*) FROM competition_candidate_snapshots)::text AS snapshot_count,
          (SELECT count(*) FROM competition_final_results)::text AS final_result_count,
          (SELECT count(*) FROM competition_award_claims)::text AS award_count
      `);
  const roundStatuses = await client.query(
    "SELECT status,count(*)::text AS count FROM competition_rounds GROUP BY status ORDER BY status",
  );
  const attemptStatuses = await client.query(
    "SELECT status,count(*)::text AS count FROM competition_attempts GROUP BY status ORDER BY status",
  );
  const awardStatuses = await client.query(
    "SELECT status,count(*)::text AS count FROM competition_award_claims GROUP BY status ORDER BY status",
  );
  const pending = await client.query(`
        SELECT
          count(*) FILTER (WHERE status='issued' AND expires_at<=statement_timestamp())::text AS issued_past_expiry,
          count(*) FILTER (WHERE status='pending' AND statement_timestamp()-coalesce(received_at,issued_at)>=interval '5 minutes')::text AS pending_five_minutes,
          count(*) FILTER (WHERE status='pending' AND statement_timestamp()-coalesce(received_at,issued_at)>=interval '15 minutes')::text AS pending_fifteen_minutes,
          floor(max(extract(epoch FROM statement_timestamp()-coalesce(received_at,issued_at))) FILTER (WHERE status='pending'))::bigint::text AS oldest_pending_seconds,
          count(*) FILTER (WHERE status='rejected')::text AS rejected_total,
          count(*) FILTER (WHERE status='rejected' AND received_at>=statement_timestamp()-interval '24 hours')::text AS rejected_received_last_24h,
          count(*) FILTER (WHERE status='rejected' AND rejection_code IS NULL)::text AS rejected_without_code
        FROM competition_attempts
      `);
  return buildHealth({
    health: health.rows,
    roundStatuses: roundStatuses.rows,
    attemptStatuses: attemptStatuses.rows,
    awardStatuses: awardStatuses.rows,
    pending: pending.rows,
  });
}

/** Inject a pg-compatible client for tests. Every database read is transactional. */
export async function collectCompetitionPreflight(client, expectedDatabase) {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    await client.query("SET LOCAL statement_timeout = '15s'");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '30s'");
    await client.query("SET LOCAL row_security = off");
    const identity = (
      await client.query(
        "SELECT current_database() AS database_name,statement_timestamp() AS server_now",
      )
    ).rows[0];
    if (!identity || identity.database_name !== expectedDatabase)
      throw new CompetitionPreflightError("connected_database_mismatch");
    const migrationTablePresent = Boolean(
      (
        await client.query(
          "SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS present",
        )
      ).rows[0]?.present,
    );
    const schema = assessSchemaProof(
      await inspectSchema(client, migrationTablePresent),
    );
    const health = schema.complete ? await inspectHealth(client) : null;
    await client.query("ROLLBACK");
    return {
      version: 1,
      ok: schema.complete,
      observedAt: new Date(identity.server_now).toISOString(),
      database: { confirmed: true },
      transaction: "repeatable-read, read-only, rolled back",
      scope: "schema proof and aggregate competition counts only",
      schema,
      health,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}
