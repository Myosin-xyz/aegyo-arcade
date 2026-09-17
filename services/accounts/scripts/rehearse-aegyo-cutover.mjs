#!/usr/bin/env node
// Synthetic only: owns a new Unix-socket cluster; never reads deployment env files.
import "./check-runtime.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync, execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  chmod,
  readFile,
  writeFile,
  rm,
  realpath,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { userInfo } from "node:os";
import pg from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createProofProvider } from "../src/proof-provider.mjs";
import { installCredentialGuards } from "../src/credential-guards.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const aegyo = await realpath(process.argv[2] || "../missing-aegyo-checkout");
await readFile(join(aegyo, "scripts/shared-auth/install-mappings.mjs"));
const privateRoot = join(root, ".proof");
await mkdir(privateRoot, { recursive: true, mode: 0o700 });
const run = await mkdtemp(join(privateRoot, "cutover-"));
await mkdir(join(aegyo, ".proof"), { recursive: true, mode: 0o700 });
const localArtifacts = await mkdtemp(join(aegyo, ".proof", "cutover-"));
const socket = await mkdtemp("/tmp/aegyo-idp-proof-");
await chmod(socket, 0o700);
const data = join(run, "data");
const cleanEnv = { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR };
const username = userInfo().username;
const dbUrl = (database) =>
  `postgresql://${encodeURIComponent(username)}@localhost/${database}?host=${encodeURIComponent(socket)}`;
const pools = [];
const pool = (database) => {
  const result = new pg.Pool({
    host: socket,
    database,
    user: username,
    max: 3,
  });
  pools.push(result);
  return result;
};
const privateJson = async (path, value) =>
  writeFile(path, JSON.stringify(value) + "\n", { mode: 0o600, flag: "wx" });
const json = async (path) => JSON.parse(await readFile(path, "utf8"));
const pepper = "synthetic-bridge-pepper";
const password = "Synthetic-bridge-password-안녕-123";
const hash = createHash("sha256")
  .update(password + pepper)
  .digest("hex");
const issuer = "https://accounts.example.test/api/auth";
let started = false;
let success = false;
let phase = "cluster-start";
const checks = [];
function command(cwd, script, args, env, expected = 0) {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    env: { ...cleanEnv, ...env },
    encoding: "utf8",
    timeout: 30000,
  });
  const output = (result.stdout || "") + (result.stderr || "");
  for (const secret of [
    pepper,
    password,
    hash,
    "bridge@example.invalid",
    dbUrl("bridge_source"),
  ])
    assert.ok(
      !output.includes(secret),
      "operator output must not expose synthetic credentials or identities",
    );
  assert.equal(
    result.status,
    expected,
    `operator step failed: ${script} ${args[0] || ""}`,
  );
  return result.stdout.trim().split("\n").at(-1);
}
try {
  execFileSync(
    "initdb",
    ["-D", data, "--auth=trust", "--no-locale", "-E", "UTF8"],
    { env: cleanEnv, stdio: "pipe" },
  );
  execFileSync(
    "pg_ctl",
    [
      "-D",
      data,
      "-l",
      join(run, "postgres.log"),
      "-o",
      `-F -p 5432 -c listen_addresses='' -k '${socket}'`,
      "-w",
      "start",
    ],
    { env: cleanEnv, stdio: "pipe" },
  );
  started = true;
  phase = "fixture";
  const admin = pool("postgres");
  await admin.query("CREATE DATABASE bridge_source");
  await admin.query("CREATE DATABASE bridge_accounts");
  await admin.query(
    "CREATE ROLE bridge_runtime LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS",
  );
  const source = pool("bridge_source");
  const target = pool("bridge_accounts");
  await source.query(`
    CREATE TABLE "User"(id text PRIMARY KEY, email text UNIQUE NOT NULL, "displayName" text, "passwordHash" text NOT NULL, "emailVerified" boolean NOT NULL, "createdAt" timestamptz NOT NULL, role text);
    CREATE TABLE "Session"(id text PRIMARY KEY, "userId" text REFERENCES "User"(id), token text NOT NULL, "expiresAt" timestamptz NOT NULL);
    CREATE TABLE "Favorite"(id text PRIMARY KEY, "userId" text REFERENCES "User"(id), "entityId" text NOT NULL);
  `);
  await source.query('INSERT INTO "User" VALUES ($1,$2,$3,$4,true,$5,$6)', [
    "legacy-bridge",
    "bridge@example.invalid",
    "Synthetic member",
    hash,
    "2026-01-01T00:00:00Z",
    "moderator",
  ]);
  await source.query(
    `INSERT INTO "Session" VALUES ('old-session','legacy-bridge','synthetic-old-cookie','2099-01-01'); INSERT INTO "Favorite" VALUES ('favorite-1','legacy-bridge','artist-1')`,
  );
  const before = (
    await source.query(
      `SELECT jsonb_build_object('users',(SELECT jsonb_agg(u) FROM "User" u),'sessions',(SELECT jsonb_agg(s) FROM "Session" s),'favorites',(SELECT jsonb_agg(f) FROM "Favorite" f)) AS state`,
    )
  ).rows[0].state;
  phase = "provider-migrations";
  const { auth, options } = createProofProvider({
    database: target,
    secret: "synthetic-bridge-provider-secret-32-characters",
    legacyPepper: pepper,
    mailbox: [],
  });
  await (await getMigrations(options)).runMigrations();
  await installCredentialGuards(target);
  await target.query(
    "CREATE TABLE aegyo_schema_version(version integer); INSERT INTO aegyo_schema_version VALUES (1)",
  );
  const snapshot = join(run, "snapshot.json");
  const imported = join(run, "imported.json");
  const credentialProof = join(run, "credential.json");
  await privateJson(credentialProof, {
    sourceUserId: "legacy-bridge",
    password,
    deployedPepperDigest: createHash("sha256").update(pepper).digest("hex"),
  });
  const importEnv = {
    ACCOUNTS_IMPORT_SOURCE_DATABASE_URL: dbUrl("bridge_source"),
    ACCOUNTS_IMPORT_SOURCE_DATABASE_NAME: "bridge_source",
    ACCOUNTS_IMPORT_SOURCE_NAMESPACE: "synthetic/owned-cluster/bridge",
    ACCOUNTS_IMPORT_ISSUER: issuer,
    ACCOUNTS_IMPORT_TARGET_DATABASE_URL: dbUrl("bridge_accounts"),
    ACCOUNTS_IMPORT_TARGET_DATABASE_NAME: "bridge_accounts",
    ACCOUNTS_IMPORT_EXPECTED_COUNT: "1",
    ACCOUNTS_IMPORT_INPUT: snapshot,
    ACCOUNTS_IMPORT_OUTPUT: snapshot,
    ACCOUNTS_LEGACY_PEPPER: pepper,
    ACCOUNTS_IMPORT_CREDENTIAL_PROOF: credentialProof,
  };
  phase = "import-cli";
  const captured = JSON.parse(
    command(root, "scripts/import-legacy.mjs", ["snapshot"], {
      ...importEnv,
      ACCOUNTS_IMPORT_CONFIRM: "read-only-private-source-snapshot",
    }),
  );
  importEnv.ACCOUNTS_IMPORT_APPROVED_DIGEST = captured.snapshotDigest;
  command(root, "scripts/import-legacy.mjs", ["init-journal"], {
    ...importEnv,
    ACCOUNTS_DATABASE_ROLE: "bridge_runtime",
    ACCOUNTS_IMPORT_CONFIRM: "install-operator-only-journal",
  });
  command(root, "scripts/import-legacy.mjs", ["apply"], {
    ...importEnv,
    ACCOUNTS_IMPORT_OUTPUT: imported,
    ACCOUNTS_IMPORT_CONFIRM: "source-writers-and-target-traffic-frozen",
  });
  const transfer = await json(imported);
  assert.equal(transfer.mapping.pairs.length, 1);
  checks.push(
    "actual snapshot, credential proof, atomic import and mapping artifact",
  );

  phase = "mapping-cli";
  const localState = async () => ({
    version: 1,
    users: (
      await source.query(`
    SELECT u.id, u.role, jsonb_build_object(
      'Session', coalesce((SELECT jsonb_agg(s.id ORDER BY s.id) FROM "Session" s WHERE s."userId"=u.id), '[]'::jsonb),
      'Favorite', coalesce((SELECT jsonb_agg(f.id ORDER BY f.id) FROM "Favorite" f WHERE f."userId"=u.id), '[]'::jsonb)
    ) AS "linkedRecords" FROM "User" u ORDER BY u.id
  `)
    ).rows,
  });
  const localSnapshot = await localState();
  const paths = ["local", "accounts", "mapping", "after", "manifest"].map(
    (name) => join(localArtifacts, name + ".json"),
  );
  await privateJson(paths[0], localSnapshot);
  await privateJson(paths[1], transfer.accounts);
  await privateJson(paths[2], transfer.mapping);
  await privateJson(paths[3], await localState());
  command(aegyo, "scripts/shared-auth/reconcile.mjs", paths, {});
  const manifest = await json(paths[4]);
  await source.query(
    await readFile(
      join(
        aegyo,
        "prisma/migrations/20260911200000_add_shared_auth/migration.sql",
      ),
      "utf8",
    ),
  );
  const mappingEnv = {
    AEGYO_MAPPING_DATABASE_URL: dbUrl("bridge_source"),
    AEGYO_MAPPING_DATABASE_NAME: "bridge_source",
    AEGYO_AUTH_BASE_URL: "https://accounts.example.test",
    AEGYO_MAPPING_MANIFEST: paths[4],
    AEGYO_MAPPING_APPROVED_DIGEST: manifest.mappingDigest,
  };
  command(
    aegyo,
    "scripts/shared-auth/install-mappings.mjs",
    ["activate"],
    {
      ...mappingEnv,
      AEGYO_MAPPING_CONFIRM: "activate-reviewed-shared-auth-cutover",
    },
    1,
  );
  assert.equal(
    (await source.query('SELECT count(*)::int AS n FROM "AuthCutoverLatch"'))
      .rows[0].n,
    0,
  );
  command(aegyo, "scripts/shared-auth/install-mappings.mjs", ["apply"], {
    ...mappingEnv,
    AEGYO_MAPPING_CONFIRM: "install-reviewed-mappings-without-latch",
  });
  const inactive = JSON.parse(
    command(
      aegyo,
      "scripts/shared-auth/install-mappings.mjs",
      ["status"],
      mappingEnv,
    ),
  );
  assert.equal(inactive.active, false);
  command(aegyo, "scripts/shared-auth/install-mappings.mjs", ["activate"], {
    ...mappingEnv,
    AEGYO_MAPPING_CONFIRM: "activate-reviewed-shared-auth-cutover",
  });
  assert.equal(
    JSON.parse(
      command(
        aegyo,
        "scripts/shared-auth/install-mappings.mjs",
        ["status"],
        mappingEnv,
      ),
    ).active,
    true,
  );
  checks.push(
    "actual cross-repo reconciliation, mapping installation and separately gated activation",
  );
  phase = "preservation";
  const login = await auth.handler(
    new Request(issuer + "/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://accounts.example.test",
        "x-aegyo-proof-ip": "192.0.2.99",
      },
      body: JSON.stringify({ email: "bridge@example.invalid", password }),
    }),
  );
  assert.equal(login.status, 200);
  const signedIn = (await login.json()).user;
  assert.equal(signedIn.id, transfer.mapping.pairs[0].subject);
  assert.equal(signedIn.role, "user");
  const identity = (
    await source.query('SELECT "userId", subject FROM "SharedAuthIdentity"')
  ).rows;
  assert.deepEqual(identity, [
    { userId: "legacy-bridge", subject: signedIn.id },
  ]);
  const after = (
    await source.query(
      `SELECT jsonb_build_object('users',(SELECT jsonb_agg(u) FROM "User" u),'sessions',(SELECT jsonb_agg(jsonb_build_object('id',s.id,'userId',s."userId",'token',s.token,'expiresAt',s."expiresAt")) FROM "Session" s),'favorites',(SELECT jsonb_agg(f) FROM "Favorite" f)) AS state`,
    )
  ).rows[0].state;
  assert.deepEqual(after, before);
  assert.deepEqual(await localState(), localSnapshot);
  checks.push(
    "old password authenticates to exact local identity; role, hash, favorites and legacy session preserved",
  );
  command(root, "scripts/import-legacy.mjs", ["apply"], {
    ...importEnv,
    ACCOUNTS_IMPORT_OUTPUT: join(run, "retry.json"),
    ACCOUNTS_IMPORT_CONFIRM: "source-writers-and-target-traffic-frozen",
  });
  command(aegyo, "scripts/shared-auth/install-mappings.mjs", ["apply"], {
    ...mappingEnv,
    AEGYO_MAPPING_CONFIRM: "install-reviewed-mappings-without-latch",
  });
  assert.equal(
    (await target.query('SELECT count(*)::int AS n FROM "user"')).rows[0].n,
    1,
  );
  assert.equal(
    (await source.query('SELECT count(*)::int AS n FROM "SharedAuthIdentity"'))
      .rows[0].n,
    1,
  );
  checks.push(
    "exact replay after activation adds no duplicate accounts or mappings",
  );
  success = true;
} catch (error) {
  console.error("Phase:", phase, "error:", error.code || error.name);
  console.error(
    "Synthetic cross-repo rehearsal failed; no production data or connection was used.",
  );
  process.exitCode = 1;
} finally {
  await Promise.allSettled(pools.map((entry) => entry.end()));
  if (started) {
    try {
      execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], {
        env: cleanEnv,
        stdio: "pipe",
      });
      started = false;
    } catch {
      console.error(
        "Disposable cluster shutdown failed; inspect the private cutover directory.",
      );
      process.exitCode = 1;
    }
  }
  if (!started) {
    await rm(socket, { recursive: true, force: true });
    await rm(run, { recursive: true, force: true });
  }
  await rm(localArtifacts, { recursive: true, force: true });
  if (success && !process.exitCode)
    console.log(
      JSON.stringify({
        passed: checks.length,
        checks,
        syntheticOnly: true,
        clusterRemoved: true,
      }),
    );
}
