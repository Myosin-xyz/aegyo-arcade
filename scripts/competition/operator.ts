#!/usr/bin/env -S node --import tsx
import { open as openFile, readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { operatorDatabaseClientConfig } from "./operator-db-config.mjs";
import type { Db } from "../../src/db/client";
import {
  closeRound,
  createDraftRound,
  disqualifyAttempt,
  finalizeRound,
  fulfillAward,
  openRound,
  operatorReviewBundle,
  rejectPendingAttempt,
  settleAttempt,
  validateDraftRoundDefinition,
} from "../../src/competition/operations-store";
import { materialLaunchBlockers } from "../../src/competition/launch-readiness";

type Args = Record<string, string>;

function parseArgs(argv: string[]): { command: string; args: Args } {
  const [command = "", ...rest] = argv;
  const args: Args = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || value === undefined)
      throw new Error(`Invalid argument ${key ?? ""}`);
    args[key.slice(2)] = value;
  }
  return { command, args };
}

function required(args: Args, key: string): string {
  const value = args[key];
  if (!value?.trim()) throw new Error(`--${key} is required`);
  return value;
}

async function main() {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === "validate-definition") {
    const definition = JSON.parse(
      await readFile(required(args, "definition-file"), "utf8"),
    );
    const validated = validateDraftRoundDefinition(definition);
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: true,
          slug: validated.slug,
          opensAt: validated.opensAt.toISOString(),
          closesAt: validated.closesAt.toISOString(),
          rules: validated.rules,
          launchBlockers: materialLaunchBlockers(validated.rules),
        },
        null,
        2,
      )}\n`,
    );
    return;
  }
  const connectionString = process.env.COMPETITION_OPERATOR_DATABASE_URL;
  if (!connectionString)
    throw new Error(
      "COMPETITION_OPERATOR_DATABASE_URL is required (DATABASE_URL is never used)",
    );
  const expectedDatabase = required(args, "expected-database");
  if (required(args, "confirm-database") !== expectedDatabase) {
    throw new Error(
      "--confirm-database must exactly match --expected-database",
    );
  }
  if (
    command !== "create-draft" &&
    process.env.ARCADE_COMPETITION_ENABLED !== "true"
  ) {
    throw new Error(
      "ARCADE_COMPETITION_ENABLED must equal true for an operator rehearsal",
    );
  }
  const pool = new Pool({
    ...operatorDatabaseClientConfig(connectionString),
    max: 1,
  });
  try {
    const database = (
      await pool.query<{ name: string }>("SELECT current_database() AS name")
    ).rows[0]?.name;
    if (database !== expectedDatabase)
      throw new Error(
        "Connected database does not match the explicitly confirmed name",
      );
    const db = drizzle(pool) as unknown as Db;
    const mutationIdentity = () => ({
      actor: required(args, "actor"),
      idempotencyKey: required(args, "idempotency-key"),
    });
    let result: unknown;
    if (command === "create-draft") {
      const definition = JSON.parse(
        await readFile(required(args, "definition-file"), "utf8"),
      );
      result = await createDraftRound(db, {
        definition,
        ...mutationIdentity(),
      });
    } else if (command === "open") {
      result = await openRound(db, {
        roundId: required(args, "round-id"),
        ...mutationIdentity(),
      });
    } else if (command === "close") {
      result = await closeRound(db, {
        roundId: required(args, "round-id"),
        ...mutationIdentity(),
      });
    } else if (command === "disqualify") {
      result = await disqualifyAttempt(db, {
        roundId: required(args, "round-id"),
        attemptId: required(args, "attempt-id"),
        ...mutationIdentity(),
        reason: required(args, "reason"),
      });
    } else if (command === "settle") {
      result = await settleAttempt(db, {
        roundId: required(args, "round-id"),
        attemptId: required(args, "attempt-id"),
        ...mutationIdentity(),
      });
    } else if (command === "reject-pending") {
      result = await rejectPendingAttempt(db, {
        roundId: required(args, "round-id"),
        attemptId: required(args, "attempt-id"),
        reason: required(args, "reason"),
        ...mutationIdentity(),
      });
    } else if (command === "export-review") {
      result = await operatorReviewBundle(db, required(args, "round-id"));
      const output = required(args, "output");
      const file = await openFile(output, "wx", 0o600);
      try {
        await file.writeFile(`${JSON.stringify(result, null, 2)}\n`, "utf8");
      } finally {
        await file.close();
      }
      result = { written: output };
    } else if (command === "finalize") {
      const review = JSON.parse(
        await readFile(required(args, "review-file"), "utf8"),
      );
      result = await finalizeRound(db, {
        roundId: required(args, "round-id"),
        approvedBy: required(args, "actor"),
        idempotencyKey: required(args, "idempotency-key"),
        tieDecisions: review.tieDecisions,
        awards: review.awards,
      });
    } else if (command === "fulfill") {
      result = await fulfillAward(db, {
        awardId: required(args, "award-id"),
        ...mutationIdentity(),
        fulfillmentKey: required(args, "fulfillment-key"),
        reason: required(args, "reason"),
      });
    } else {
      throw new Error(
        "Command must be validate-definition, create-draft, open, close, settle, reject-pending, disqualify, export-review, finalize, or fulfill",
      );
    }
    const safeResult =
      command === "close" &&
      typeof result === "object" &&
      result &&
      "kind" in result &&
      result.kind === "snapshot"
        ? {
            kind: result.kind,
            snapshotId: (result as unknown as { snapshot: { id: string } })
              .snapshot.id,
            sourceDigest: (
              result as unknown as { snapshot: { source_digest: string } }
            ).snapshot.source_digest,
            standingCount: (
              result as unknown as { snapshot: { standings: unknown[] } }
            ).snapshot.standings.length,
            repeated: (result as unknown as { repeated: boolean }).repeated,
          }
        : command === "finalize"
          ? {
              finalResultId: (result as { finalResultId: string })
                .finalResultId,
              standingCount: (result as { standings: unknown[] }).standings
                .length,
              repeated: (result as { repeated: boolean }).repeated,
            }
          : result;
    process.stdout.write(`${JSON.stringify(safeResult)}\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Operator command failed"}\n`,
  );
  process.exitCode = 1;
});
