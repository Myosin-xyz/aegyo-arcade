import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createLocalJWKSet, jwtVerify } from "jose";
import { createAccountsProvider } from "../src/provider-core.mjs";
import { installCredentialGuards } from "../src/credential-guards.mjs";
import { PRODUCTION_CLIENTS } from "../scripts/provision-production-clients-lib.mjs";

const socket = process.env.ACCOUNTS_PROOF_PG_SOCKET;
test(
  "offline production client provisioner is atomic, idempotent, and usable",
  { skip: !socket },
  async (t) => {
    const admin = new pg.Pool({
      host: socket,
      user: userInfo().username,
      database: "postgres",
    });
    await admin.query("CREATE DATABASE accounts_production");
    const database = new pg.Pool({
      host: socket,
      user: userInfo().username,
      database: "accounts_production",
      max: 4,
    });
    t.after(async () => {
      await database.end();
      await admin.query("DROP DATABASE accounts_production");
      await admin.end();
    });
    const secret = randomBytes(48).toString("base64url");
    const pepper = "synthetic-production-pepper";
    const { options } = createAccountsProvider({
      database,
      secret,
      legacyPepper: pepper,
      baseURL: "https://account.aegyoarena.com",
    });
    await (await getMigrations(options)).runMigrations();
    await installCredentialGuards(database);
    await database.query(
      "CREATE TABLE aegyo_schema_version(version integer); INSERT INTO aegyo_schema_version VALUES (1)",
    );
    const proof = await mkdtemp(join(tmpdir(), "accounts-client-manifest-"));
    const clients = PRODUCTION_CLIENTS.map(
      ([key, redirectUri, postLogoutRedirectUri], i) => ({
        key,
        redirectUri,
        postLogoutRedirectUri,
        clientId: `aegyo_first_party_${i}_${"i".repeat(24)}`,
        clientSecret: `aegyo_secret_${i}_${"s".repeat(40)}`,
      }),
    );
    const manifest = join(proof, "clients.json");
    await writeFile(manifest, JSON.stringify({ version: 1, clients }), {
      mode: 0o600,
    });
    const dbUrl = `postgresql://${encodeURIComponent(userInfo().username)}@localhost/accounts_production?host=${encodeURIComponent(socket)}`;
    const baseEnv = {
      PATH: process.env.PATH,
      ACCOUNTS_ENVIRONMENT: "production",
      ACCOUNTS_TRAFFIC_ENABLED: "false",
      ACCOUNTS_SIGNUP_ENABLED: "false",
      ACCOUNTS_PRODUCTION_CLIENT_CONFIRM: "offline-first-party-clients",
      ACCOUNTS_PRODUCTION_CLIENT_LOCAL_PROOF: "disposable-unix-socket",
      ACCOUNTS_BASE_URL: "https://account.aegyoarena.com",
      ACCOUNTS_MIGRATION_DATABASE_URL: dbUrl,
      ACCOUNTS_MIGRATION_DATABASE_NAME: "accounts_production",
      ACCOUNTS_PRODUCTION_CLIENT_MANIFEST: manifest,
      BETTER_AUTH_SECRET: secret,
      ACCOUNTS_LEGACY_PEPPER: pepper,
    };
    const run = (extra = {}, expected = 0) => {
      const result = spawnSync(
        process.execPath,
        ["scripts/provision-production-clients.mjs"],
        {
          cwd: new URL("..", import.meta.url),
          env: { ...baseEnv, ...extra },
          encoding: "utf8",
          timeout: 30000,
        },
      );
      assert.equal(result.status, expected, result.stderr);
      for (const row of clients)
        assert.ok(
          !`${result.stdout}${result.stderr}`.includes(row.clientSecret),
        );
      return result;
    };
    run({ ACCOUNTS_BASE_URL: "https://wrong.example" }, 1);
    run(
      {
        ACCOUNTS_MIGRATION_DATABASE_URL: `postgresql://${encodeURIComponent(userInfo().username)}@localhost/postgres?host=${encodeURIComponent(socket)}`,
      },
      1,
    );
    const wrongRedirectPath = join(proof, "wrong-redirect.json");
    await writeFile(
      wrongRedirectPath,
      JSON.stringify({
        version: 1,
        clients: clients.map((x, i) =>
          i ? x : { ...x, redirectUri: "https://evil.example/callback" },
        ),
      }),
      { mode: 0o600 },
    );
    run({ ACCOUNTS_PRODUCTION_CLIENT_MANIFEST: wrongRedirectPath }, 1);
    run({ ACCOUNTS_PRODUCTION_CLIENT_PROOF_FAIL_AFTER: "1" }, 1);
    assert.deepEqual(
      (
        await database.query(
          `SELECT (SELECT count(*)::int FROM "user") users,(SELECT count(*)::int FROM "oauthClient") clients`,
        )
      ).rows[0],
      { users: 0, clients: 0 },
    );
    assert.equal(
      JSON.parse(run().stdout.trim().split("\n").at(-1)).provisioned,
      true,
    );
    assert.equal(
      JSON.parse(run().stdout.trim().split("\n").at(-1)).provisioned,
      false,
    );
    const storedClients = (
      await database.query(
        `SELECT "clientId", "clientSecret" FROM "oauthClient" ORDER BY "clientId"`,
      )
    ).rows;
    assert.equal(storedClients.length, 3);
    for (const stored of storedClients) {
      const source = clients.find((row) => row.clientId === stored.clientId);
      assert.ok(source);
      assert.notEqual(stored.clientSecret, source.clientSecret);
      assert.ok(stored.clientSecret.length > 32);
    }
    const changed = {
      version: 1,
      clients: clients.map((x, i) =>
        i ? x : { ...x, clientSecret: x.clientSecret + "changed" },
      ),
    };
    const changedPath = join(proof, "changed.json");
    await writeFile(changedPath, JSON.stringify(changed), { mode: 0o600 });
    run({ ACCOUNTS_PRODUCTION_CLIENT_MANIFEST: changedPath }, 1);
    assert.deepEqual(
      (
        await database.query(
          `SELECT (SELECT count(*)::int FROM "user") users,(SELECT count(*)::int FROM "oauthClient") clients`,
        )
      ).rows[0],
      { users: 0, clients: 3 },
    );

    const { auth } = createAccountsProvider({
      database,
      secret,
      legacyPepper: pepper,
      baseURL: "https://account.aegyoarena.com",
      signupAllowed: true,
    });
    const signup = await auth.handler(
      new Request("https://account.aegyoarena.com/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://account.aegyoarena.com",
        },
        body: JSON.stringify({
          name: "Synthetic post-provision member",
          email: "post-provision@example.invalid",
          password: "Synthetic-password-123",
        }),
      }),
    );
    assert.equal(signup.status, 200);
    const userId = (await signup.clone().json()).user.id;
    const cookie = signup.headers
      .getSetCookie()
      .map((x) => x.split(";", 1)[0])
      .join("; ");
    await database.query(`UPDATE "user" SET "emailVerified"=true WHERE id=$1`, [
      userId,
    ]);
    for (const client of clients) {
      const verifier = randomBytes(32).toString("base64url");
      const nonce = randomBytes(16).toString("hex");
      const query = new URLSearchParams({
        client_id: client.clientId,
        redirect_uri: client.redirectUri,
        response_type: "code",
        scope: "openid email profile",
        state: "state",
        nonce,
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        max_age: "300",
      });
      const authorize = await auth.handler(
        new Request(
          `https://account.aegyoarena.com/api/auth/oauth2/authorize?${query}`,
          { headers: { cookie } },
        ),
      );
      const callback = new URL(authorize.headers.get("location"));
      assert.ok(callback.searchParams.get("code"));
      const basic = Buffer.from(
        `${client.clientId}:${client.clientSecret}`,
      ).toString("base64");
      const token = await auth.handler(
        new Request("https://account.aegyoarena.com/api/auth/oauth2/token", {
          method: "POST",
          headers: {
            authorization: `Basic ${basic}`,
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: client.clientId,
            redirect_uri: client.redirectUri,
            code: callback.searchParams.get("code"),
            code_verifier: verifier,
          }),
        }),
      );
      assert.equal(token.status, 200);
      const tokens = await token.json();
      const jwks = await (
        await auth.handler(
          new Request("https://account.aegyoarena.com/api/auth/jwks"),
        )
      ).json();
      const { payload } = await jwtVerify(
        tokens.id_token,
        createLocalJWKSet(jwks),
        {
          issuer: "https://account.aegyoarena.com/api/auth",
          audience: client.clientId,
        },
      );
      assert.equal(payload.sub, userId);
      assert.equal(payload.nonce, nonce);
    }
  },
);
