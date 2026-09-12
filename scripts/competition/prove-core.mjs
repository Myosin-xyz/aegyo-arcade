#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import process from "node:process";

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
  for (const migration of [
    "0000_foamy_rogue.sql",
    "0001_arcade_shared_auth.sql",
    "0002_arcade_competition.sql",
  ]) {
    run(
      "docker",
      [
        "exec",
        "-i",
        name,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-U",
        "postgres",
        "-d",
        "arcade_proof",
      ],
      {
        input: readFileSync(
          new URL(`../../src/db/migrations/${migration}`, import.meta.url),
          "utf8",
        ),
      },
    );
  }
  const port = run("docker", ["port", name, "5432/tcp"]).split(":").at(-1);
  const testUrl = `postgres://postgres:${password}@127.0.0.1:${port}/arcade_proof`;
  run(
    "npx",
    [
      "vitest",
      "run",
      "tests/db/competition-core.test.ts",
      "tests/db/counted-runs.test.ts",
      "tests/db/claw-invariants.test.ts",
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
