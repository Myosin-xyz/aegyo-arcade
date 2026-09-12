import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import pg from "pg";
import { createAccountsProvider } from "../src/provider-core.mjs";
import { checkDatabaseReadiness } from "../src/security-state.mjs";

const socket = process.env.ACCOUNTS_PROOF_PG_SOCKET;
const fixture = "aegyo_migration_fixture";
const foreignFixture = "aegyo_migration_foreign_fixture";
const appRole = "aegyo_migration_app";
const syntheticPassword = "synthetic-migration-role-password";

function ownerURL(database) {
  return `postgresql://${userInfo().username}@localhost/${database}?host=${encodeURIComponent(socket)}`;
}

function migrate(database, extra = {}) {
  const env = {
    ...process.env,
    ACCOUNTS_MIGRATION_CONFIRM: "dedicated-accounts-database",
    ACCOUNTS_MIGRATION_DATABASE_URL: ownerURL(database),
    ACCOUNTS_DATABASE_ROLE: appRole,
    ...extra,
  };
  delete env.DATABASE_URL;
  for (const [name, value] of Object.entries(env))
    if (value === undefined) delete env[name];
  return spawnSync(process.execPath, ["scripts/migrate.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env,
  });
}

function upgradeGuards(database) {
  const env = {
    ...process.env,
    ACCOUNTS_GUARD_UPGRADE_CONFIRM: "oauth-token-revocation-v2",
    ACCOUNTS_GUARD_UPGRADE_DATABASE_NAME: database,
    ACCOUNTS_MIGRATION_DATABASE_URL: ownerURL(database),
  };
  delete env.DATABASE_URL;
  return spawnSync(process.execPath, ["scripts/upgrade-credential-guards.mjs"], {
    cwd: new URL("..", import.meta.url),
    encoding: "utf8",
    env,
  });
}

test(
  "explicit migration initializes only a dedicated Accounts database and restricts its application role",
  { skip: !socket },
  async (t) => {
    assert.match(socket, /^\/tmp\/aegyo-idp-proof-[A-Za-z0-9]+$/);
    const cluster = new pg.Pool({
      host: socket,
      port: 5432,
      user: userInfo().username,
      database: "postgres",
      max: 1,
    });
    t.after(() => cluster.end());
    await cluster.query(`CREATE DATABASE ${fixture}`);
    await cluster.query(`CREATE DATABASE ${foreignFixture}`);

    const first = migrate(fixture, {
      ACCOUNTS_DATABASE_ROLE_PASSWORD: syntheticPassword,
    });
    assert.equal(first.status, 0, "first migration must succeed");
    const second = migrate(fixture, {
      ACCOUNTS_DATABASE_ROLE_PASSWORD: undefined,
    });
    assert.equal(second.status, 0, "unchanged migration must be idempotent");

    const owner = new pg.Pool({ connectionString: ownerURL(fixture), max: 1 });
    const app = new pg.Pool({
      connectionString: `postgresql://${appRole}:${syntheticPassword}@localhost/${fixture}?host=${encodeURIComponent(socket)}`,
      max: 2,
    });
    t.after(async () => {
      await app.end();
      await owner.end();
    });
    assert.equal(await checkDatabaseReadiness(app), true);

    await owner.query(
      await readFile(
        new URL("../src/credential-guards-v1.sql", import.meta.url),
        "utf8",
      ),
    );
    await owner.query(
      "ALTER TABLE public.aegyo_schema_version DROP COLUMN guard_revision",
    );
    await assert.rejects(checkDatabaseReadiness(app));
    const upgraded = upgradeGuards(fixture);
    assert.equal(upgraded.status, 0, upgraded.stderr);
    assert.equal(await checkDatabaseReadiness(app), true);
    const repeatedUpgrade = upgradeGuards(fixture);
    assert.equal(repeatedUpgrade.status, 1);
    assert.match(repeatedUpgrade.stderr, /guard_upgrade_already_applied/);

    await assert.rejects(
      app.query(
        `UPDATE public."user" SET "securityVersion"="securityVersion"+1`,
      ),
      (error) => error?.code === "42501",
    );
    await assert.rejects(
      app.query(`UPDATE public."user" SET role='admin'`),
      (error) => error?.code === "42501",
    );

    const mailbox = [];
    const { auth } = createAccountsProvider({
      database: app,
      secret: "synthetic-migration-provider-secret-32-bytes",
      legacyPepper: "synthetic-migration-pepper",
      baseURL: "https://accounts-migration.invalid",
      signupAllowed: true,
      mail: async (kind, message) => mailbox.push({ kind, message }),
    });
    const request = (path, body) =>
      auth.handler(
        new Request(`https://accounts-migration.invalid/api/auth${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://accounts-migration.invalid",
            "x-aegyo-client-ip": "192.0.2.10",
          },
          body: JSON.stringify(body),
        }),
      );
    const email = "migration-member@example.invalid";
    assert.equal(
      (
        await request("/sign-up/email", {
          name: "Migration member",
          email,
          password: "Synthetic-before-reset-123",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/request-password-reset", {
          email,
          redirectTo: "https://accounts-migration.invalid/reset-password",
        })
      ).status,
      200,
    );
    const recovery = mailbox.find(({ kind }) => kind === "reset");
    assert.ok(recovery);
    assert.equal(
      (
        await request("/reset-password", {
          token: recovery.message.token,
          newPassword: "Synthetic-after-reset-456",
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await request("/sign-in/email", {
          email,
          password: "Synthetic-after-reset-456",
        })
      ).status,
      200,
    );

    await owner.query(
      `ALTER TABLE public."account" DISABLE TRIGGER aegyo_credential_changed`,
    );
    assert.equal(await checkDatabaseReadiness(app), false);

    const foreign = new pg.Pool({
      connectionString: ownerURL(foreignFixture),
      max: 1,
    });
    await foreign.query("CREATE TABLE unrelated_data (id integer PRIMARY KEY)");
    await foreign.end();
    const refused = migrate(foreignFixture, {
      ACCOUNTS_DATABASE_ROLE_PASSWORD: syntheticPassword,
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /not an initialized Accounts database/);
  },
);
