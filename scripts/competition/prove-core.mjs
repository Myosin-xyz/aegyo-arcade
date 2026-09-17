#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";

const confirmation = "disposable-local-postgres";
if (process.env.ARCADE_COMPETITION_PROOF_CONFIRM !== confirmation) {
  console.error(
    `Set ARCADE_COMPETITION_PROOF_CONFIRM=${confirmation} to create an isolated disposable container.`,
  );
  process.exit(2);
}
if (process.env.DATABASE_URL || process.env.TEST_DATABASE_URL) {
  console.error(
    "Refusing to run with DATABASE_URL or TEST_DATABASE_URL inherited.",
  );
  process.exit(2);
}

const name = `aegyo-competition-proof-${process.pid}-${randomBytes(3).toString("hex")}`;
const password = randomBytes(24).toString("hex");
let created = false;
const migrations = [
  "0000_foamy_rogue.sql",
  "0001_arcade_shared_auth.sql",
  "0002_arcade_competition.sql",
  "0003_monthly_scoring_windows.sql",
  "0004_expand_competition_games.sql",
];
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: options.input ? ["pipe", "inherit", "inherit"] : "pipe",
    ...options,
  });
  if (result.status !== 0)
    throw new Error(
      `${command} failed${result.stderr ? `: ${result.stderr.trim()}` : ""}`,
    );
  return result.stdout?.trim() ?? "";
};
const applyMigration = (container, database, migration) =>
  run(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-d",
      database,
    ],
    {
      input: readFileSync(
        new URL(`../../src/db/migrations/${migration}`, import.meta.url),
        "utf8",
      ),
    },
  );

try {
  run("docker", [
    "run",
    "--detach",
    "--rm",
    "--name",
    name,
    "--publish",
    "127.0.0.1::5432",
    "--env",
    `POSTGRES_PASSWORD=${password}`,
    "--env",
    "POSTGRES_DB=arcade_proof",
    "postgres:18-alpine",
  ]);
  created = true;
  let ready = false;
  for (let i = 0; i < 60; i++) {
    const result = spawnSync(
      "docker",
      [
        "exec",
        name,
        "psql",
        "-Atqc",
        "SELECT 1",
        "-U",
        "postgres",
        "-d",
        "arcade_proof",
      ],
      { stdio: "ignore" },
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  if (!ready)
    throw new Error("PostgreSQL did not become ready within 15 seconds");
  // Prove the additive game constraint against a pre-0004 database containing
  // legacy competition evidence before building the clean test database.
  run("docker", [
    "exec",
    name,
    "createdb",
    "-U",
    "postgres",
    "arcade_upgrade_proof",
  ]);
  for (const migration of migrations.slice(0, -1))
    applyMigration(name, "arcade_upgrade_proof", migration);
  run("docker", [
    "exec",
    name,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "arcade_upgrade_proof",
    "-c",
    `INSERT INTO account_members(id,issuer,subject) VALUES
       ('81000000-0000-4000-8000-000000000001','upgrade-proof','member');
     INSERT INTO competition_rounds(id,slug,rules,status,opens_at,closes_at) VALUES
       ('82000000-0000-4000-8000-000000000001','upgrade-proof','{}','draft',now()+interval '1 day',now()+interval '2 days');
     INSERT INTO competition_attempts
       (id,round_id,member_id,provider_session_id,game_id,day_key,score_period_key,ordinal,idempotency_key,seed,issued_at,expires_at)
     VALUES
       ('83000000-0000-4000-8000-000000000001','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','upgrade','snake','2026-09-17','2026-09-14',1,'upgrade-snake','seed',now(),now()+interval '5 minutes'),
       ('83000000-0000-4000-8000-000000000002','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','upgrade','flappy','2026-09-17','2026-09-14',1,'upgrade-flappy','seed',now(),now()+interval '5 minutes');`,
  ]);
  applyMigration(name, "arcade_upgrade_proof", migrations.at(-1));
  run("docker", [
    "exec",
    name,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "arcade_upgrade_proof",
    "-c",
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM competition_attempts
          WHERE id='83000000-0000-4000-8000-000000000001'
            AND round_id='82000000-0000-4000-8000-000000000001'
            AND member_id='81000000-0000-4000-8000-000000000001'
            AND game_id='snake' AND day_key='2026-09-17'
            AND score_period_key='2026-09-14'
       ) THEN
         RAISE EXCEPTION 'snake attempt changed during migration';
       END IF;
       IF NOT EXISTS (
         SELECT 1 FROM competition_attempts
          WHERE id='83000000-0000-4000-8000-000000000002'
            AND round_id='82000000-0000-4000-8000-000000000001'
            AND member_id='81000000-0000-4000-8000-000000000001'
            AND game_id='flappy' AND day_key='2026-09-17'
            AND score_period_key='2026-09-14'
       ) THEN
         RAISE EXCEPTION 'flappy attempt changed during migration';
       END IF;
     END $$;`,
  ]);
  run("docker", [
    "exec",
    name,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-d",
    "arcade_upgrade_proof",
    "-c",
    `INSERT INTO competition_attempts
       (id,round_id,member_id,provider_session_id,game_id,day_key,score_period_key,ordinal,idempotency_key,seed,issued_at,expires_at)
     VALUES
       ('83000000-0000-4000-8000-000000000003','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','upgrade','perfect-toss','2026-09-17','2026-09-14',1,'upgrade-perfect-toss','seed',now(),now()+interval '5 minutes'),
       ('83000000-0000-4000-8000-000000000004','82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001','upgrade','hangman','2026-09-17','2026-09-14',1,'upgrade-hangman','seed',now(),now()+interval '5 minutes');
     DO $$ BEGIN
       IF (SELECT count(*) FROM competition_attempts) <> 4 OR
          (SELECT count(*) FROM competition_attempts
            WHERE (id='83000000-0000-4000-8000-000000000003'
                   AND game_id='perfect-toss')
               OR (id='83000000-0000-4000-8000-000000000004'
                   AND game_id='hangman')) <> 2 THEN
         RAISE EXCEPTION 'expanded games were not inserted as expected';
       END IF;
     END $$;`,
  ]);
  for (const migration of migrations)
    applyMigration(name, "arcade_proof", migration);
  const port = run("docker", ["port", name, "5432/tcp"]).split(":").at(-1);
  const testUrl = `postgres://postgres:${password}@127.0.0.1:${port}/arcade_proof`;
  run(
    process.execPath,
    [
      fileURLToPath(
        new URL("../../node_modules/vitest/vitest.mjs", import.meta.url),
      ),
      "run",
      ...(process.argv.includes("--all")
        ? []
        : [
            "tests/db/competition-core.test.ts",
            "tests/db/competition-operations.test.ts",
            "tests/db/competition-monthly-rehearsal.test.ts",
            "tests/db/counted-runs.test.ts",
            "tests/db/claw-invariants.test.ts",
          ]),
      "--no-file-parallelism",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        TEST_DATABASE_URL: testUrl,
        ARCADE_COMPETITION_ENABLED: "true",
      },
    },
  );
  console.log(
    "Competition core PostgreSQL proof passed in an isolated disposable database.",
  );
} finally {
  if (created)
    spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" });
}
