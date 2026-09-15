#!/usr/bin/env node
import "./check-runtime.mjs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { validateManifest } from "./provision-production-clients-lib.mjs";

const execute = promisify(execFile);
const report = (stream, value) =>
  new Promise((resolve, reject) =>
    stream.write(`${JSON.stringify(value)}\n`, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
let directory;
try {
  if (
    process.env.DATABASE_URL ||
    process.env.ACCOUNTS_ENVIRONMENT !== "production" ||
    process.env.ACCOUNTS_BASE_URL !== "https://account.aegyoarena.com" ||
    process.env.ACCOUNTS_TRAFFIC_ENABLED !== "false" ||
    process.env.ACCOUNTS_SIGNUP_ENABLED !== "false" ||
    process.env.ACCOUNTS_PRODUCTION_CLIENT_CONFIRM !==
      "offline-first-party-clients"
  )
    throw new Error("preparation_gate_failed");

  const manifest = JSON.parse(process.env.ACCOUNTS_PRODUCTION_CLIENTS_JSON);
  validateManifest(manifest);
  directory = await mkdtemp(join(tmpdir(), "accounts-clients-"));
  const path = join(directory, "clients.json");
  await writeFile(path, JSON.stringify(manifest), { mode: 0o600, flag: "wx" });
  const environment = {
    ...process.env,
    ACCOUNTS_PRODUCTION_CLIENT_MANIFEST: path,
  };
  delete environment.ACCOUNTS_PRODUCTION_CLIENTS_JSON;

  // Child output stays private, including exceptional provider diagnostics.
  await execute(
    process.execPath,
    [new URL("./provision-production-clients.mjs", import.meta.url).pathname],
    {
      env: environment,
      timeout: 120_000,
      maxBuffer: 65_536,
    },
  );
  const { stdout } = await execute(
    process.execPath,
    [new URL("./verify-production-preparation.mjs", import.meta.url).pathname],
    {
      env: { ...environment, ACCOUNTS_EXPECTED_CLIENTS: "3" },
      timeout: 45_000,
      maxBuffer: 65_536,
    },
  );
  const result = JSON.parse(stdout.trim().split("\n").at(-1));
  if (
    result.databaseVerified !== true ||
    result.clients !== 3 ||
    result.users !== 0 ||
    result.authenticationActivated !== false
  )
    throw new Error("preparation_verification_failed");
  await report(process.stdout, result);
} catch {
  await report(process.stderr, {
    productionClientPreparation: "failed",
    authenticationActivated: false,
  });
  process.exitCode = 1;
} finally {
  if (directory) await rm(directory, { recursive: true, force: true });
}
