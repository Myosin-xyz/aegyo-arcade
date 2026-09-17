// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  assessSchemaProof,
  collectCompetitionPreflight,
  EXPECTED_COLUMNS,
  EXPECTED_CONSTRAINTS,
  EXPECTED_FUNCTIONS,
  EXPECTED_INDEXES,
  EXPECTED_MIGRATIONS,
  EXPECTED_TABLES,
  EXPECTED_TRIGGERS,
  validateDatabaseSelection,
} from "../../scripts/competition/preflight-lib.mjs";
import { main as preflightMain } from "../../scripts/competition/preflight.mjs";

function completeProof() {
  return {
    migrationTablePresent: true,
    migrations: EXPECTED_MIGRATIONS.map((migration) => ({
      created_at: migration.createdAt,
      hash: migration.hash,
    })),
    tables: EXPECTED_TABLES.map((name) => ({ name })),
    columns: EXPECTED_COLUMNS.map(
      ([table_name, column_name, notNull, data_type]) => ({
        table_name,
        column_name,
        is_nullable: notNull ? "NO" : "YES",
        data_type,
      }),
    ),
    constraints: Object.entries(EXPECTED_CONSTRAINTS).map(
      ([name, definition]) => ({ name, validated: true, definition }),
    ),
    indexes: Object.entries(EXPECTED_INDEXES).map(([name, fragments]) => ({
      name,
      definition: fragments.join(" "),
    })),
    triggers: Object.entries(EXPECTED_TRIGGERS).map(([name, table_name]) => ({
      name,
      table_name,
      enabled: "O",
    })),
    functions: Object.entries(EXPECTED_FUNCTIONS).map(([name, fragments]) => ({
      name,
      definition: fragments.join(" "),
    })),
  };
}

describe("competition database preflight", () => {
  it("requires an exact, explicit database-name confirmation", () => {
    expect(validateDatabaseSelection("arcade_prod", "arcade_prod")).toBe(
      "arcade_prod",
    );
    expect(() =>
      validateDatabaseSelection("arcade_prod", "arcade_stage"),
    ).toThrow("database_confirmation_mismatch");
    expect(() => validateDatabaseSelection("", "")).toThrow(
      "database_confirmation_required",
    );
  });

  it("accepts the argument separator used by package runners", async () => {
    await expect(
      preflightMain(
        [
          "--",
          "--expected-database",
          "arcade_prod",
          "--confirm-database",
          "arcade_prod",
        ],
        { NODE_ENV: "test" },
      ),
    ).rejects.toThrow("operator_database_url_required");
  });

  it("accepts a complete migration, schema, integrity, and game proof", () => {
    const assessment = assessSchemaProof(completeProof());
    expect(assessment.complete).toBe(true);
    expect(assessment.migrationHistory.verified).toBe(5);
    expect(assessment.objects.missingTables).toEqual([]);
  });

  it("refuses missing or altered migration history", () => {
    const missing = completeProof();
    missing.migrations.pop();
    expect(assessSchemaProof(missing).migrationHistory.missing).toEqual([
      "0004_expand_competition_games",
    ]);

    const altered = completeProof();
    altered.migrations[3].hash = "wrong";
    const assessment = assessSchemaProof(altered);
    expect(assessment.complete).toBe(false);
    expect(assessment.migrationHistory.mismatched).toEqual([
      "0003_monthly_scoring_windows",
    ]);
  });

  it("refuses a stale game constraint, nullable scoring key, or disabled trigger", () => {
    const proof = completeProof();
    proof.constraints.find(
      ({ name }) => name === "competition_attempt_game",
    )!.definition = "snake flappy";
    proof.columns.find(
      ({ column_name }) => column_name === "score_period_key",
    )!.is_nullable = "YES";
    proof.triggers.find(
      ({ name }) => name === "competition_evidence_frozen",
    )!.enabled = "D";
    const assessment = assessSchemaProof(proof);
    expect(assessment.complete).toBe(false);
    expect(assessment.objects.mismatchedConstraints).toContain(
      "competition_attempt_game",
    );
    expect(assessment.objects.mismatchedColumns).toContain(
      "competition_attempts.score_period_key",
    );
    expect(assessment.objects.disabledTriggers).toContain(
      "competition_evidence_frozen",
    );
  });

  it("refuses weaker point bounds that merely contain the expected number", () => {
    const proof = completeProof();
    proof.constraints.find(
      ({ name }) => name === "competition_period_best_points",
    )!.definition = "CHECK (points BETWEEN -1000 AND 10000)";
    expect(assessSchemaProof(proof).objects.mismatchedConstraints).toContain(
      "competition_period_best_points",
    );
  });

  it("refuses a date constraint that mentions both columns but allows reversal", () => {
    const proof = completeProof();
    proof.constraints.find(
      ({ name }) => name === "competition_round_dates",
    )!.definition = "CHECK (closes_at IS DISTINCT FROM opens_at)";
    expect(assessSchemaProof(proof).objects.mismatchedConstraints).toContain(
      "competition_round_dates",
    );
  });

  it("preserves logical grouping while comparing claim-state protection", () => {
    const proof = completeProof();
    proof.constraints.find(
      ({ name }) => name === "competition_claim_state",
    )!.definition =
      "CHECK ((status = 'unclaimed'::text AND private_proof IS NULL AND claim_proof_digest IS NULL AND claimed_at IS NULL OR status = ANY (ARRAY['claimed'::text, 'fulfilled'::text])) AND private_proof IS NOT NULL AND claim_proof_digest IS NOT NULL AND claimed_at IS NOT NULL OR status = 'void'::text)";
    expect(assessSchemaProof(proof).objects.mismatchedConstraints).toContain(
      "competition_claim_state",
    );
  });

  it("starts read-only and rolls back before inspecting a wrongly selected database", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("current_database"))
        return {
          rows: [
            {
              database_name: "wrong_database",
              server_now: "2026-09-17T12:00:00.000Z",
            },
          ],
        };
      return { rows: [] };
    });
    await expect(
      collectCompetitionPreflight({ query }, "expected_database"),
    ).rejects.toThrow("connected_database_mismatch");
    expect(query.mock.calls[0]?.[0]).toBe(
      "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
    expect(
      query.mock.calls.some(([sql]) => sql.includes("competition_rounds")),
    ).toBe(false);
  });

  it("refuses incomplete schema without running aggregate health queries", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("current_database"))
        return {
          rows: [
            {
              database_name: "arcade_prod",
              server_now: "2026-09-17T12:00:00.000Z",
            },
          ],
        };
      if (sql.includes("to_regclass")) return { rows: [{ present: false }] };
      return { rows: [] };
    });
    const report = await collectCompetitionPreflight({ query }, "arcade_prod");
    expect(report.ok).toBe(false);
    expect(report.health).toBeNull();
    expect(report.database).toEqual({ confirmed: true });
    expect(JSON.stringify(report)).not.toContain("arcade_prod");
    expect(
      query.mock.calls.some(([sql]) => sql.includes("SELECT count(*)")),
    ).toBe(false);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("returns only aggregate health after the complete schema proof", async () => {
    const proof = completeProof();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("current_database"))
        return {
          rows: [
            {
              database_name: "arcade_prod",
              server_now: "2026-09-17T12:00:00.000Z",
            },
          ],
        };
      if (sql.includes("to_regclass")) return { rows: [{ present: true }] };
      if (sql.includes("drizzle.__drizzle_migrations"))
        return { rows: proof.migrations };
      if (sql.includes("FROM pg_catalog.pg_class c"))
        return { rows: proof.tables };
      if (sql.includes("FROM information_schema.columns"))
        return { rows: proof.columns };
      if (sql.includes("FROM pg_catalog.pg_constraint"))
        return { rows: proof.constraints };
      if (sql.includes("FROM pg_catalog.pg_indexes"))
        return { rows: proof.indexes };
      if (sql.includes("FROM pg_catalog.pg_trigger"))
        return { rows: proof.triggers };
      if (sql.includes("FROM pg_catalog.pg_proc"))
        return { rows: proof.functions };
      if (sql.includes("AS round_total"))
        return {
          rows: [
            {
              round_total: "2",
              upcoming_rounds: "1",
              active_window_rounds: "1",
              past_close_not_final: "0",
              open_outside_window: "0",
              enrollment_count: "8",
              challenge_count: "4",
              attempt_count: "12",
              period_best_count: "3",
              period_bonus_count: "2",
              ledger_count: "5",
              snapshot_count: "0",
              final_result_count: "0",
              award_count: "0",
            },
          ],
        };
      if (sql.includes("FROM competition_rounds GROUP BY status"))
        return {
          rows: [
            { status: "draft", count: "1" },
            { status: "open", count: "1" },
          ],
        };
      if (sql.includes("FROM competition_attempts GROUP BY status"))
        return {
          rows: [
            { status: "pending", count: "2" },
            { status: "verified", count: "10" },
          ],
        };
      if (sql.includes("FROM competition_award_claims GROUP BY status"))
        return { rows: [] };
      if (sql.includes("AS issued_past_expiry"))
        return {
          rows: [
            {
              issued_past_expiry: "0",
              pending_five_minutes: "2",
              pending_fifteen_minutes: "1",
              oldest_pending_seconds: "901",
              rejected_total: "0",
              rejected_received_last_24h: "0",
              rejected_without_code: "0",
            },
          ],
        };
      return { rows: [] };
    });
    const report = await collectCompetitionPreflight({ query }, "arcade_prod");
    expect(report.ok).toBe(true);
    expect(report.observedAt).toBe("2026-09-17T12:00:00.000Z");
    expect(report.health?.rounds.byStatus).toEqual({
      draft: 1,
      open: 1,
      closing: 0,
      review: 0,
      final: 0,
    });
    expect(report.health?.attempts.oldestPendingSeconds).toBe(901);
    expect(report.health?.attempts.byStatus.pending).toBe(2);
    expect(query.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
});
