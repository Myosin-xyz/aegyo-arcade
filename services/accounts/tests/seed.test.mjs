import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { userInfo } from "node:os";
import { join } from "node:path";
import test from "node:test";
import pg from "pg";

const socket = process.env.ACCOUNTS_PROOF_PG_SOCKET;
const fixture = "aegyo_seed_fixture";
const appRole = "aegyo_seed_app";
const appPassword = "synthetic-seed-role-password";
const serviceRoot = new URL("..", import.meta.url);

function ownerURL(database) {
  return `postgresql://${userInfo().username}@localhost/${database}?host=${encodeURIComponent(socket)}`;
}

function subprocess(script, environment) {
  const env = { ...process.env, ...environment };
  delete env.DATABASE_URL;
  return spawnSync(process.execPath, [script], {
    cwd: serviceRoot,
    encoding: "utf8",
    env,
    timeout: 60_000,
  });
}

test(
  "staging seed bootstraps one synthetic member and three registered clients once",
  { skip: !socket, timeout: 120_000 },
  async (t) => {
    assert.match(socket, /^\/tmp\/aegyo-idp-proof-[A-Za-z0-9]+$/);
    const cluster = new pg.Pool({
      host: socket,
      port: 5432,
      user: userInfo().username,
      database: "postgres",
      max: 1,
    });
    await cluster.query(`CREATE DATABASE ${fixture}`);
    await cluster.end();

    const migration = subprocess("scripts/migrate.mjs", {
      ACCOUNTS_MIGRATION_CONFIRM: "dedicated-accounts-database",
      ACCOUNTS_MIGRATION_DATABASE_NAME: fixture,
      ACCOUNTS_MIGRATION_DATABASE_URL: ownerURL(fixture),
      ACCOUNTS_DATABASE_ROLE: appRole,
      ACCOUNTS_DATABASE_ROLE_PASSWORD: appPassword,
    });
    assert.equal(migration.status, 0, migration.stderr);

    const outputDirectory = await mkdtemp(
      new URL("../.proof/seed-test-", import.meta.url),
    );
    t.after(() => rm(outputDirectory, { recursive: true, force: true }));
    const outputPath = join(outputDirectory, "credentials.json");
    const clients = ["arcade", "aegyo", "daebak"].map((name) => ({
      name: `Synthetic ${name}`,
      redirectUri: `https://${name}.example.test/api/accounts/callback`,
      postLogoutRedirectUri: `https://${name}.example.test/`,
    }));
    const seedEnvironment = {
      ACCOUNTS_ENVIRONMENT: "staging",
      ACCOUNTS_STAGING_SEED_CONFIRM: "synthetic-only",
      ACCOUNTS_MIGRATION_DATABASE_URL: ownerURL(fixture),
      ACCOUNTS_BASE_URL: "https://accounts.example.test",
      BETTER_AUTH_SECRET: "synthetic-staging-seed-secret-at-least-32-bytes",
      ACCOUNTS_LEGACY_PEPPER: "synthetic-staging-seed-pepper",
      ACCOUNTS_STAGING_CLIENTS_JSON: JSON.stringify(clients),
      ACCOUNTS_STAGING_OUTPUT_PATH: outputPath,
    };
    const seeded = subprocess("scripts/seed-staging.mjs", seedEnvironment);
    assert.equal(seeded.status, 0, seeded.stderr);
    assert.match(
      seeded.stdout,
      /Seeded 1 synthetic member and 3 OAuth clients/,
    );
    assert.doesNotMatch(
      seeded.stdout + seeded.stderr,
      /clientSecret|password/i,
    );

    const owner = new pg.Pool({
      connectionString: ownerURL(fixture),
      max: 1,
    });
    const users = await owner.query(
      `SELECT email, role, banned, "emailVerified" FROM public."user" ORDER BY email`,
    );
    assert.equal(users.rowCount, 2);
    const operator = users.rows.find(
      ({ email }) => email === "fake@example.invalid",
    );
    const member = users.rows.find(
      ({ email }) => email !== "fake@example.invalid",
    );
    assert.deepEqual(
      { role: operator?.role, banned: operator?.banned },
      { role: "user", banned: true },
    );
    assert.match(member?.email, /^synthetic-[a-f0-9]{24}@example\.invalid$/);
    assert.equal(member?.emailVerified, false);
    assert.equal(
      (
        await owner.query(
          'SELECT count(*)::integer AS count FROM public."session"',
        )
      ).rows[0].count,
      0,
    );
    const registered = await owner.query(
      `SELECT "clientId", "redirectUris", "postLogoutRedirectUris", scopes,
              "grantTypes", "responseTypes", "tokenEndpointAuthMethod",
              "skipConsent", "requirePKCE", "enableEndSession", disabled
         FROM public."oauthClient" ORDER BY name`,
    );
    assert.equal(registered.rowCount, 3);
    for (const client of registered.rows) {
      assert.equal(client.tokenEndpointAuthMethod, "client_secret_basic");
      assert.equal(client.skipConsent, true);
      assert.equal(client.requirePKCE, true);
      assert.equal(client.enableEndSession, true);
      assert.equal(client.disabled, false);
      assert.deepEqual(client.grantTypes, ["authorization_code"]);
      assert.deepEqual(client.responseTypes, ["code"]);
      assert.deepEqual(
        new Set(client.scopes),
        new Set(["openid", "email", "profile"]),
      );
      assert.equal(client.redirectUris.length, 1);
      assert.equal(client.postLogoutRedirectUris.length, 1);
    }

    const outputBefore = await readFile(outputPath);
    const output = JSON.parse(outputBefore.toString("utf8"));
    assert.equal(output.member.email, member.email);
    assert.equal(typeof output.member.password, "string");
    assert.equal(output.clients.length, 3);
    assert.ok(
      output.clients.every(
        ({ clientId, clientSecret }) => clientId && clientSecret,
      ),
    );
    assert.equal((await stat(outputPath)).mode & 0o777, 0o600);
    assert.equal((await stat(outputDirectory)).mode & 0o777, 0o700);

    const repeated = subprocess("scripts/seed-staging.mjs", seedEnvironment);
    assert.equal(repeated.status, 1);
    assert.match(repeated.stderr, /user table is not empty/);
    assert.deepEqual(await readFile(outputPath), outputBefore);
    assert.equal(
      (
        await owner.query(
          'SELECT count(*)::integer AS count FROM public."user"',
        )
      ).rows[0].count,
      2,
    );
    await owner.end();
  },
);

test(
  "staging seed refuses missing confirmation before database access",
  { skip: !socket },
  () => {
    const refused = subprocess("scripts/seed-staging.mjs", {
      ACCOUNTS_ENVIRONMENT: "staging",
    });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /ACCOUNTS_STAGING_SEED_CONFIRM/);
    assert.doesNotMatch(refused.stderr, /at file:/);
  },
);
