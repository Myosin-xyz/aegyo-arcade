import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { userInfo } from "node:os";
import pg from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createLocalJWKSet, jwtVerify } from "jose";
import {
  createProofProvider,
  RESET_STATE_CLAIM,
} from "../src/proof-provider.mjs";
import { LEGACY_PREFIX, passwordFunctions } from "../src/passwords.mjs";
import { installCredentialGuards } from "../src/credential-guards.mjs";
import { proveRuntimeFlow } from "./runtime-flow.mjs";
import { proveCredentialTransitions } from "./credential-transitions.mjs";

const socket = process.env.ACCOUNTS_PROOF_PG_SOCKET;

test(
  "Better Auth 1.7.4 with an isolated real PostgreSQL database",
  { skip: !socket },
  async (t) => {
    const database = new pg.Pool({
      host: socket,
      port: 5432,
      user: userInfo().username,
      database: "postgres",
      max: 4,
    });
    const mailbox = [];
    const config = {
      database,
      secret: randomBytes(48).toString("base64url"),
      legacyPepper: "synthetic-pepper-사랑",
      mailbox,
    };
    let { auth, options } = createProofProvider(config);
    t.after(() => database.end());
    const migration = await getMigrations(options);
    assert.equal(migration.unsafeChanges.length, 0);
    await migration.runMigrations();
    await installCredentialGuards(database);

    const issuer = "https://accounts.example.test/api/auth";
    let ipCounter = 0;
    async function request(
      path,
      { body, cookie = "", ip, method, provider = auth } = {},
    ) {
      const headers = new Headers({
        origin: "https://accounts.example.test",
        "x-aegyo-proof-ip": ip ?? `192.0.2.${++ipCounter}`,
      });
      if (cookie) headers.set("cookie", cookie);
      if (body)
        headers.set(
          "content-type",
          body instanceof URLSearchParams
            ? "application/x-www-form-urlencoded"
            : "application/json",
        );
      return provider.handler(
        new Request(issuer + path, {
          method: method ?? (body ? "POST" : "GET"),
          headers,
          body: body
            ? body instanceof URLSearchParams
              ? body.toString()
              : JSON.stringify(body)
            : undefined,
        }),
      );
    }
    const cookies = (response) =>
      response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
    const email = "member@example.invalid";
    const password = "Synthetic-password-123";
    const signup = await request("/sign-up/email", {
      body: { name: "Synthetic member", email, password },
    });
    assert.equal(signup.status, 200);
    const signupBody = await signup.json();
    const userId = signupBody.user.id;
    let providerCookie = cookies(signup);
    const operatorSignup = await request("/sign-up/email", {
      body: {
        name: "Synthetic operator",
        email: "operator@example.invalid",
        password: "Operator-fixture-123",
      },
    });
    assert.equal(operatorSignup.status, 200);
    const operatorId = (await operatorSignup.json()).user.id;
    // Offline bootstrap only in this disposable database. No email-to-role rule.
    await database.query("UPDATE \"user\" SET role='admin' WHERE id=$1", [
      operatorId,
    ]);
    const operatorCookie = cookies(operatorSignup);
    const clients = [];
    for (const product of ["aegyo", "arcade", "daebak"]) {
      const client = await auth.api.adminCreateOAuthClient({
        headers: new Headers({ cookie: operatorCookie }),
        body: {
          client_name: `Proof ${product}`,
          redirect_uris: [`https://${product}.example.test/callback`],
          post_logout_redirect_uris: [`https://${product}.example.test/`],
          scope: "openid email profile",
          grant_types: ["authorization_code"],
          token_endpoint_auth_method: "client_secret_basic",
          skip_consent: true,
          enable_end_session: true,
          require_pkce: true,
        },
      });
      clients.push(client);
    }

    function transaction(client, overrides = {}) {
      const verifier = randomBytes(32).toString("base64url");
      const query = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: client.redirect_uris[0],
        response_type: "code",
        scope: "openid email profile",
        state: randomBytes(24).toString("hex"),
        nonce: randomBytes(24).toString("hex"),
        code_challenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        code_challenge_method: "S256",
        max_age: "300",
        prompt: "none",
        ...overrides,
      });
      return { client, query, verifier };
    }
    async function authorize(tx, cookie = providerCookie) {
      const response = await request("/oauth2/authorize?" + tx.query, {
        cookie,
      });
      const location = response.headers.get("location");
      assert.ok(
        location,
        `Authorization returned status ${response.status} without a redirect`,
      );
      return new URL(location, issuer);
    }
    async function exchange(tx, code, verifier = tx.verifier) {
      return auth.handler(
        new Request(issuer + "/oauth2/token", {
          method: "POST",
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            "x-aegyo-proof-ip": `198.51.100.${++ipCounter}`,
            authorization:
              "Basic " +
              Buffer.from(
                `${tx.client.client_id}:${tx.client.client_secret}`,
              ).toString("base64"),
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: tx.client.client_id,
            redirect_uri: tx.client.redirect_uris[0],
            code,
            code_verifier: verifier,
          }),
        }),
      );
    }

    async function resetTimestamp(id = userId) {
      return (
        await database.query(
          'SELECT "passwordChangedAt" FROM "user" WHERE id=$1',
          [id],
        )
      ).rows[0].passwordChangedAt;
    }

    async function verifiedClaims(client) {
      const tx = transaction(client);
      const callback = await authorize(tx);
      assert.equal(callback.origin, new URL(client.redirect_uris[0]).origin);
      assert.equal(callback.searchParams.get("state"), tx.query.get("state"));
      assert.equal(callback.searchParams.get("iss"), issuer);
      assert.ok(callback.searchParams.get("code"));
      const response = await exchange(tx, callback.searchParams.get("code"));
      assert.equal(response.status, 200);
      const tokens = await response.json();
      const jwks = await (await request("/jwks")).json();
      const { payload } = await jwtVerify(
        tokens.id_token,
        createLocalJWKSet(jwks),
        { issuer, audience: client.client_id },
      );
      assert.equal(payload.sub, userId);
      assert.equal(payload.nonce, tx.query.get("nonce"));
      return payload;
    }

    await t.test(
      "three distinct clients reuse the same IdP session and receive verified identity claims",
      async () => {
        // Distinguish original authentication from newly minted token iat.
        await database.query(
          'UPDATE "session" SET "createdAt"=now()-interval \'2 minutes\' WHERE "userId"=$1',
          [userId],
        );
        const session = (
          await database.query(
            'SELECT "createdAt" FROM "session" WHERE "userId"=$1',
            [userId],
          )
        ).rows[0];
        for (const client of clients) {
          const tx = transaction(client);
          const callback = await authorize(tx);
          assert.equal(
            callback.origin,
            new URL(client.redirect_uris[0]).origin,
          );
          assert.equal(
            callback.searchParams.get("state"),
            tx.query.get("state"),
          );
          assert.equal(callback.searchParams.get("iss"), issuer);
          assert.ok(callback.searchParams.get("code"));
          const response = await exchange(
            tx,
            callback.searchParams.get("code"),
          );
          assert.equal(response.status, 200);
          const tokens = await response.json();
          const jwks = await (await request("/jwks")).json();
          const { payload } = await jwtVerify(
            tokens.id_token,
            createLocalJWKSet(jwks),
            { issuer, audience: client.client_id },
          );
          assert.equal(payload.sub, userId);
          assert.equal(payload.nonce, tx.query.get("nonce"));
          assert.equal(
            payload.auth_time,
            Math.floor(session.createdAt.getTime() / 1000),
          );
          assert.ok(payload.iat > payload.auth_time);
          assert.deepEqual(payload[RESET_STATE_CLAIM], {
            version: 1,
            kind: "database",
            lastPasswordReset: null,
          });
          assert.equal(tokens.refresh_token, undefined);
          assert.notEqual(
            (await exchange(tx, callback.searchParams.get("code"))).status,
            200,
          );
        }
      },
    );

    await t.test(
      "max_age=0 cannot silently reuse a valid session",
      async () => {
        const callback = await authorize(
          transaction(clients[0], { max_age: "0" }),
        );
        assert.equal(callback.searchParams.get("error"), "login_required");
        assert.equal(callback.searchParams.has("code"), false);
        const interactive = await authorize(
          transaction(clients[0], { max_age: "0", prompt: "login" }),
        );
        assert.equal(interactive.pathname, "/sign-in");
      },
    );

    await t.test(
      "stale max_age, missing SSO, unsafe PKCE and wrong verifier are rejected",
      async () => {
        await database.query(
          'UPDATE "session" SET "createdAt"=now()-interval \'10 minutes\' WHERE "userId"=$1',
          [userId],
        );
        assert.equal(
          (await authorize(transaction(clients[0]))).searchParams.get("error"),
          "login_required",
        );
        await database.query(
          'UPDATE "session" SET "createdAt"=now() WHERE "userId"=$1',
          [userId],
        );
        assert.equal(
          (await authorize(transaction(clients[0]), "")).searchParams.get(
            "error",
          ),
          "login_required",
        );
        assert.equal(
          (
            await authorize(
              transaction(clients[0], { code_challenge_method: "plain" }),
            )
          ).searchParams.has("code"),
          false,
        );
        const tx = transaction(clients[0]);
        const callback = await authorize(tx);
        assert.notEqual(
          (
            await exchange(
              tx,
              callback.searchParams.get("code"),
              randomBytes(32).toString("base64url"),
            )
          ).status,
          200,
        );
      },
    );

    await t.test(
      "redirect mismatch and public client registration fail closed",
      async () => {
        const response = await request(
          "/oauth2/authorize?" +
            transaction(clients[0], {
              redirect_uri: "https://attacker.example.test/callback",
            }).query,
          { cookie: providerCookie },
        );
        const location = response.headers.get("location");
        assert.equal(
          location?.startsWith("https://attacker.example.test"),
          false,
        );
        assert.notEqual(
          (
            await request("/oauth2/register", {
              body: {
                redirect_uris: ["https://attacker.example.test/callback"],
              },
            })
          ).status,
          200,
        );
        assert.notEqual(
          (
            await request("/oauth2/create-client", {
              cookie: providerCookie,
              body: {
                redirect_uris: ["https://attacker.example.test/callback"],
              },
            })
          ).status,
          200,
        );
      },
    );

    await proveRuntimeFlow(t, {
      database,
      config,
      auth,
      request,
      cookies,
      clients,
      transaction,
      authorize,
      exchange,
      userId,
      operatorId,
      providerCookie,
      email,
      password,
    });

    await t.test(
      "password reset persists the signed cutoff and invalidates both devices, cleared app cookies, and pre-reset codes",
      async () => {
        const deviceB = await request("/sign-in/email", {
          body: { email, password },
        });
        assert.equal(deviceB.status, 200);
        const staleBCookie = cookies(deviceB);
        const tx = transaction(clients[0]);
        const preResetCode = (
          await authorize(tx, staleBCookie)
        ).searchParams.get("code");
        assert.ok(preResetCode);
        const forgot = await request("/request-password-reset", {
          body: {
            email,
            redirectTo: "https://accounts.example.test/reset-password",
          },
        });
        assert.equal(forgot.status, 200);
        assert.equal(mailbox.length, 1);
        assert.equal(await resetTimestamp(), null);
        const resetStarted = Date.now();
        const reset = await request("/reset-password", {
          body: {
            token: mailbox[0].token,
            newPassword: "Changed-password-123",
            passwordChangedAt: "2000-01-01T00:00:00.000Z",
          },
        });
        assert.equal(reset.status, 200);
        const resetFinished = Date.now();
        const persistedReset = await resetTimestamp();
        assert.ok(persistedReset instanceof Date);
        assert.ok(persistedReset.getTime() >= resetStarted);
        assert.ok(persistedReset.getTime() <= resetFinished);
        assert.equal(await resetTimestamp(operatorId), null);
        assert.equal(
          Number(
            (
              await database.query(
                'SELECT count(*) FROM "session" WHERE "userId"=$1',
                [userId],
              )
            ).rows[0].count,
          ),
          0,
        );
        assert.equal(
          Number(
            (
              await database.query(
                'SELECT count(*) FROM "session" WHERE "userId"=$1',
                [operatorId],
              )
            ).rows[0].count,
          ),
          1,
        );
        // Requests deliberately contain only the pre-reset IdP cookie. There is
        // no local application cookie or remembered cutoff in any of these calls.
        for (const client of clients) {
          for (const cookie of [providerCookie, staleBCookie]) {
            const callback = await authorize(transaction(client), cookie);
            assert.equal(callback.searchParams.get("error"), "login_required");
            assert.equal(callback.searchParams.has("code"), false);
          }
        }
        assert.notEqual((await exchange(tx, preResetCode)).status, 200);
        assert.notEqual(
          (await request("/sign-in/email", { body: { email, password } }))
            .status,
          200,
        );
        const fresh = await request("/sign-in/email", {
          body: { email, password: "Changed-password-123" },
        });
        assert.equal(fresh.status, 200);
        providerCookie = cookies(fresh);
        // Recreate the provider to prove persisted state, not hook-local memory.
        ({ auth } = createProofProvider(config));
        for (const client of clients) {
          const claims = await verifiedClaims(client);
          assert.deepEqual(claims[RESET_STATE_CLAIM], {
            version: 1,
            kind: "database",
            lastPasswordReset: persistedReset.toISOString(),
          });
        }
        assert.notEqual(
          (
            await request("/reset-password", {
              body: { token: mailbox[0].token, newPassword: password },
            })
          ).status,
          200,
        );
        assert.equal(
          (await resetTimestamp()).toISOString(),
          persistedReset.toISOString(),
        );
      },
    );

    await t.test(
      "profile input cannot overwrite the cutoff and a second recovery advances every client's signed claim",
      async () => {
        const previous = await resetTimestamp();
        const forged = await request("/update-user", {
          cookie: providerCookie,
          body: { passwordChangedAt: "2000-01-01T00:00:00.000Z" },
        });
        assert.notEqual(forged.status, 200);
        assert.equal(
          (await resetTimestamp()).toISOString(),
          previous.toISOString(),
        );
        assert.equal(
          (await request("/request-password-reset", { body: { email } }))
            .status,
          200,
        );
        assert.equal(
          (
            await request("/reset-password", {
              body: {
                token: mailbox.at(-1).token,
                newPassword: "Changed-password-123",
              },
            })
          ).status,
          200,
        );
        const latest = await resetTimestamp();
        assert.ok(latest.getTime() > previous.getTime());
        const fresh = await request("/sign-in/email", {
          body: { email, password: "Changed-password-123" },
        });
        assert.equal(fresh.status, 200);
        providerCookie = cookies(fresh);
        for (const client of clients) {
          const claims = await verifiedClaims(client);
          assert.equal(
            claims[RESET_STATE_CLAIM].lastPasswordReset,
            latest.toISOString(),
          );
        }
        assert.equal(await resetTimestamp(operatorId), null);
      },
    );

    await t.test(
      "legacy credential verifies through the published sign-in route without changing local identity or verification",
      async () => {
        const legacyEmail = "legacy@example.invalid";
        const legacyPassword = "Árbol-팬💜-123";
        const signup = await request("/sign-up/email", {
          body: {
            name: "Legacy fixture",
            email: legacyEmail,
            password: legacyPassword,
          },
        });
        assert.equal(signup.status, 200);
        const legacyId = (await signup.json()).user.id;
        const legacyHash =
          LEGACY_PREFIX +
          createHash("sha256")
            .update(legacyPassword + config.legacyPepper, "utf8")
            .digest("hex");
        await database.query(
          'UPDATE "account" SET "password"=$1 WHERE "userId"=$2 AND "providerId"=\'credential\'',
          [legacyHash, legacyId],
        );
        const login = await request("/sign-in/email", {
          body: { email: legacyEmail, password: legacyPassword },
        });
        assert.equal(login.status, 200);
        const user = (await login.json()).user;
        assert.equal(user.id, legacyId);
        assert.equal(user.emailVerified, false);
        // Proves the limitation too: verify() does not automatically rehash.
        assert.equal(
          (
            await database.query(
              'SELECT password FROM "account" WHERE "userId"=$1',
              [legacyId],
            )
          ).rows[0].password,
          legacyHash,
        );
        // A guarded first-login upgrade can use this normal trigger path, but
        // it is intentionally a security event rather than a silent rehash.
        const beforeRehash = (
          await database.query(
            'SELECT "credentialVersion", "securityVersion", "passwordChangedAt" FROM "user" WHERE id=$1',
            [legacyId],
          )
        ).rows[0];
        const modernHash = await passwordFunctions(config.legacyPepper).hash(
          legacyPassword,
        );
        await database.query(
          'UPDATE "account" SET "password"=$1 WHERE "userId"=$2 AND "providerId"=\'credential\' AND password=$3',
          [modernHash, legacyId, legacyHash],
        );
        const afterRehash = (
          await database.query(
            'SELECT "credentialVersion", "securityVersion", "passwordChangedAt" FROM "user" WHERE id=$1',
            [legacyId],
          )
        ).rows[0];
        assert.equal(
          afterRehash.credentialVersion,
          beforeRehash.credentialVersion + 1,
        );
        assert.equal(
          afterRehash.securityVersion,
          beforeRehash.securityVersion + 1,
        );
        assert.ok(afterRehash.passwordChangedAt instanceof Date);
        assert.equal(
          Number(
            (
              await database.query(
                'SELECT count(*) FROM "session" WHERE "userId"=$1',
                [legacyId],
              )
            ).rows[0].count,
          ),
          0,
        );
      },
    );

    await proveCredentialTransitions(t, {
      database,
      config,
      auth,
      request,
      cookies,
      clients,
      transaction,
      authorize,
      exchange,
      operatorCookie,
    });

    await t.test(
      "only the operator can revoke another user's IdP sessions and ban new login",
      async () => {
        assert.notEqual(
          (
            await request("/admin/revoke-user-sessions", {
              cookie: providerCookie,
              body: { userId: operatorId },
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await request("/admin/revoke-user-sessions", {
              cookie: operatorCookie,
              body: { userId },
            })
          ).status,
          200,
        );
        for (const client of clients) {
          assert.equal(
            (await authorize(transaction(client))).searchParams.get("error"),
            "login_required",
          );
        }
        assert.equal(
          (
            await request("/admin/ban-user", {
              cookie: operatorCookie,
              body: { userId, banReason: "Synthetic proof" },
            })
          ).status,
          200,
        );
        assert.notEqual(
          (
            await request("/sign-in/email", {
              body: { email, password: "Changed-password-123" },
            })
          ).status,
          200,
        );
      },
    );

    await t.test(
      "database rate limits survive replacing the provider instance",
      async () => {
        const requestOptions = {
          body: { email, password: "wrong" },
          ip: "203.0.113.9",
        };
        for (let i = 0; i < 3; i++)
          assert.notEqual(
            (await request("/sign-in/email", requestOptions)).status,
            429,
          );
        ({ auth } = createProofProvider(config));
        assert.equal(
          (await request("/sign-in/email", requestOptions)).status,
          429,
        );
        assert.ok(
          Number(
            (await database.query('SELECT count(*) FROM "rateLimit"')).rows[0]
              .count,
          ) > 0,
        );
      },
    );
  },
);
