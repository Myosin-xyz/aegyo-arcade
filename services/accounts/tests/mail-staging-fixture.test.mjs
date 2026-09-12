import test from "node:test";
import assert from "node:assert/strict";
import { userInfo } from "node:os";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import pg from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createAccountsProvider } from "../src/provider-core.mjs";
import { validateMailFixtureConfig } from "../scripts/seed-mail-staging-fixture-lib.mjs";
const valid = {
  ACCOUNTS_ENVIRONMENT: "staging",
  ACCOUNTS_MAIL_FIXTURE_CONFIRM: "single-owner-mailbox-fixture",
  ACCOUNTS_BASE_URL: "https://aegyo-accounts-accounts-staging.up.railway.app",
  ACCOUNTS_MAIL_FIXTURE_EMAIL: "mateo@myosin.xyz",
  ACCOUNTS_MIGRATION_DATABASE_NAME: "accounts_staging",
};
test("mail fixture is bound to the isolated stage and sole authorized recipient", () => {
  assert.deepEqual(validateMailFixtureConfig(valid), {
    baseURL: valid.ACCOUNTS_BASE_URL,
    email: "mateo@myosin.xyz",
  });
  for (const changed of [
    { DATABASE_URL: "postgresql://ordinary" },
    { ACCOUNTS_MAIL_FIXTURE_EMAIL: "other@example.invalid" },
    { ACCOUNTS_ENVIRONMENT: "production" },
    { ACCOUNTS_BASE_URL: "https://account.aegyoarena.com" },
  ])
    assert.throws(() => validateMailFixtureConfig({ ...valid, ...changed }));
});

const socket = process.env.ACCOUNTS_PROOF_PG_SOCKET;
test(
  "official signup creates one private unverified mail fixture without a session",
  { skip: !socket },
  async (t) => {
    const admin = new pg.Pool({
      host: socket,
      user: userInfo().username,
      database: "postgres",
    });
    await admin.query("CREATE DATABASE accounts_staging");
    const database = new pg.Pool({
      host: socket,
      user: userInfo().username,
      database: "accounts_staging",
    });
    t.after(async () => {
      await database.end();
      await admin.query("DROP DATABASE accounts_staging");
      await admin.end();
    });
    const secret = randomBytes(48).toString("base64url");
    const pepper = "synthetic-mail-fixture-pepper";
    const { options } = createAccountsProvider({
      database,
      secret,
      legacyPepper: pepper,
      baseURL: valid.ACCOUNTS_BASE_URL,
    });
    await (await getMigrations(options)).runMigrations();
    const output = new URL(
      `../.proof/mail-fixture-${randomBytes(8).toString("hex")}.json`,
      import.meta.url,
    );
    t.after(() => unlink(output).catch(() => {}));
    const dbUrl = `postgresql://${encodeURIComponent(userInfo().username)}@localhost/accounts_staging?host=${encodeURIComponent(socket)}`;
    const env = {
      PATH: process.env.PATH,
      ...valid,
      ACCOUNTS_MAIL_FIXTURE_LOCAL_PROOF: "disposable-unix-socket",
      ACCOUNTS_MIGRATION_DATABASE_URL: dbUrl,
      ACCOUNTS_MAIL_FIXTURE_OUTPUT: output.pathname,
      BETTER_AUTH_SECRET: secret,
      ACCOUNTS_LEGACY_PEPPER: pepper,
    };
    const run = () =>
      spawnSync(process.execPath, ["scripts/seed-mail-staging-fixture.mjs"], {
        cwd: new URL("..", import.meta.url),
        env,
        encoding: "utf8",
        timeout: 30000,
      });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.ok(!first.stdout.includes(pepper));
    const artifact = JSON.parse(await readFile(output, "utf8"));
    assert.equal(artifact.email, "mateo@myosin.xyz");
    assert.ok(artifact.password.length >= 32);
    assert.equal((await stat(output)).mode & 0o077, 0);
    const state = (
      await database.query(
        `SELECT (SELECT count(*)::int FROM "user") users,(SELECT count(*)::int FROM "session") sessions,(SELECT "emailVerified" FROM "user" LIMIT 1) verified`,
      )
    ).rows[0];
    assert.deepEqual(state, { users: 1, sessions: 0, verified: false });
    const retry = run();
    assert.equal(retry.status, 1);
    assert.match(retry.stderr, /mail_fixture_identity_already_exists/);
    assert.equal(
      (await database.query('SELECT count(*)::int count FROM "user"')).rows[0]
        .count,
      1,
    );
  },
);
