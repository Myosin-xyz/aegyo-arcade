#!/usr/bin/env -S node --import tsx
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import type { Db } from "../../src/db/client";
import {
  closeRound,
  disqualifyAttempt,
  finalizeRound,
  fulfillAward,
} from "../../src/competition/operations-store";

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
  if (process.env.ARCADE_COMPETITION_ENABLED !== "true") {
    throw new Error(
      "ARCADE_COMPETITION_ENABLED must equal true for an operator rehearsal",
    );
  }
  const pool = new Pool({ connectionString, max: 1 });
  try {
    const database = (
      await pool.query<{ name: string }>("SELECT current_database() AS name")
    ).rows[0]?.name;
    if (database !== expectedDatabase)
      throw new Error(
        "Connected database does not match the explicitly confirmed name",
      );
    const db = drizzle(pool) as unknown as Db;
    const actor = required(args, "actor");
    const idempotencyKey = required(args, "idempotency-key");
    let result: unknown;
    if (command === "close") {
      result = await closeRound(db, {
        roundId: required(args, "round-id"),
        actor,
        idempotencyKey,
      });
    } else if (command === "disqualify") {
      result = await disqualifyAttempt(db, {
        roundId: required(args, "round-id"),
        attemptId: required(args, "attempt-id"),
        actor,
        reason: required(args, "reason"),
        idempotencyKey,
      });
    } else if (command === "finalize") {
      const review = JSON.parse(
        await readFile(required(args, "review-file"), "utf8"),
      );
      result = await finalizeRound(db, {
        roundId: required(args, "round-id"),
        approvedBy: actor,
        idempotencyKey,
        tieDecisions: review.tieDecisions,
        awards: review.awards,
      });
    } else if (command === "fulfill") {
      result = await fulfillAward(db, {
        awardId: required(args, "award-id"),
        actor,
        fulfillmentKey: required(args, "fulfillment-key"),
        idempotencyKey,
      });
    } else {
      throw new Error(
        "Command must be close, disqualify, finalize, or fulfill",
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
