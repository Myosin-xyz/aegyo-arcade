import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { createLocalJWKSet, jwtVerify } from "jose";
import { createAccountsServer } from "../src/http-server.mjs";
import {
  OPERATOR_CUTOFF_CLAIM,
  RESET_STATE_CLAIM,
  SECURITY_VERSION_CLAIM,
  createAccountsProvider,
} from "../src/provider-core.mjs";
import { createProofProvider } from "../src/proof-provider.mjs";

/** Real loopback transport proof for the production HTTP wrapper and OAuth UI. */
export async function proveRuntimeFlow(t, context) {
  const {
    database,
    config,
    auth,
    clients,
    transaction,
    exchange,
    request: providerRequest,
    cookies,
    userId,
    email,
    password,
  } = context;
  await t.test(
    "runtime HTTP completes interactive OAuth and protects security state",
    async () => {
      const readerKey = randomBytes(32).toString("base64url");
      const runtimeConfig = {
        baseURL: "https://accounts.example.test",
        readers: { arcade: readerKey },
        ipMode: "socket",
        signupAllowed: true,
        mail: { proof: true },
      };
      const server = createAccountsServer({
        auth,
        database,
        config: runtimeConfig,
        readiness: async () => true,
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.equal(typeof address, "object");
      const loopback = `http://127.0.0.1:${address.port}`;
      let requestNo = 0;
      const request = async (
        path,
        { method = "GET", body, headers = {} } = {},
      ) =>
        fetch(loopback + path, {
          method,
          redirect: "manual",
          headers: {
            origin: runtimeConfig.baseURL,
            // The proof provider reads this synthetic header; vary it so the
            // transport proof cannot accidentally trip a database rate limit.
            "x-aegyo-proof-ip": `203.0.113.${++requestNo}`,
            ...headers,
          },
          body:
            body === undefined
              ? undefined
              : typeof body === "string"
                ? body
                : JSON.stringify(body),
        });

      try {
        const discovery = await request(
          "/api/auth/.well-known/openid-configuration",
          {
            headers: {
              host: "10.0.0.8:9999",
              forwarded: "for=10.0.0.7;proto=http;host=evil.example",
              "x-forwarded-host": "evil.example",
              "x-forwarded-proto": "http",
              "x-real-ip": "10.0.0.6",
              "x-aegyo-client-ip": "10.0.0.5",
            },
          },
        );
        assert.equal(discovery.status, 200);
        const metadataText = await discovery.text();
        const metadata = JSON.parse(metadataText);
        assert.equal(metadata.issuer, "https://accounts.example.test/api/auth");
        assert.equal(
          metadata.authorization_endpoint,
          "https://accounts.example.test/api/auth/oauth2/authorize",
        );
        assert.equal(metadataText.includes("evil.example"), false);
        assert.equal(metadataText.includes("10.0.0."), false);

        const tx = transaction(clients[0], {
          max_age: "0",
          prompt: "login",
        });
        const authorize = await request(
          `/api/auth/oauth2/authorize?${tx.query}`,
        );
        assert.equal(authorize.status, 200);
        const authorizeBody = await authorize.json();
        assert.equal(authorizeBody.redirect, true);
        const signIn = new URL(authorizeBody.url, runtimeConfig.baseURL);
        assert.equal(signIn.origin, runtimeConfig.baseURL);
        assert.equal(signIn.pathname, "/sign-in");
        assert.ok(signIn.searchParams.get("sig"));
        assert.equal(signIn.searchParams.get("client_id"), tx.client.client_id);
        assert.equal(signIn.searchParams.get("nonce"), tx.query.get("nonce"));
        assert.equal(signIn.searchParams.get("max_age"), "0");

        const page = await request(signIn.pathname + signIn.search);
        assert.equal(page.status, 200);
        const html = await page.text();
        assert.match(html, /data-page="sign-in"/);
        assert.ok(html.includes("data-oauth-query="));
        assert.ok(
          html.includes(
            `data-trusted-redirect-uri="${tx.client.redirect_uris[0]}"`,
          ),
        );
        assert.equal(html.includes("evil.example"), false);

        const login = await request("/api/auth/sign-in/email", {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: {
            email,
            password,
            callbackURL: `${runtimeConfig.baseURL}/account`,
            oauth_query: signIn.searchParams.toString(),
          },
        });
        assert.equal(login.status, 200);
        const loginBody = await login.json();
        const callback = new URL(loginBody.url);
        assert.equal(
          callback.origin,
          new URL(tx.client.redirect_uris[0]).origin,
        );
        assert.equal(
          callback.pathname,
          new URL(tx.client.redirect_uris[0]).pathname,
        );
        assert.equal(callback.searchParams.get("state"), tx.query.get("state"));
        assert.ok(callback.searchParams.get("code"));

        const tokenResponse = await exchange(
          tx,
          callback.searchParams.get("code"),
        );
        assert.equal(tokenResponse.status, 200);
        const tokens = await tokenResponse.json();
        const jwksResponse = await request("/api/auth/jwks");
        assert.equal(jwksResponse.status, 200);
        const { payload } = await jwtVerify(
          tokens.id_token,
          createLocalJWKSet(await jwksResponse.json()),
          {
            issuer: "https://accounts.example.test/api/auth",
            audience: tx.client.client_id,
          },
        );
        assert.equal(payload.sub, userId);
        assert.equal(payload.nonce, tx.query.get("nonce"));
        assert.equal(typeof payload.sid, "string");
        assert.ok(payload.sid.length > 0);
        assert.deepEqual(payload[RESET_STATE_CLAIM], {
          version: 1,
          kind: "database",
          lastPasswordReset: null,
        });
        assert.equal(payload[SECURITY_VERSION_CLAIM], 0);
        assert.equal(payload[OPERATOR_CUTOFF_CLAIM], null);

        const statePath = "/api/internal/session-state";
        assert.equal((await request(statePath)).status, 401);
        assert.equal(
          (
            await request(statePath, {
              method: "POST",
              headers: {
                authorization: "Bearer wrong-reader-key",
                "content-type": "application/json",
              },
              body: { subject: userId, providerSessionId: payload.sid },
            })
          ).status,
          401,
        );
        assert.equal(
          (
            await request(statePath, {
              headers: { authorization: `Bearer ${readerKey}` },
            })
          ).status,
          405,
        );
        const stateResponse = await request(statePath, {
          method: "POST",
          headers: {
            authorization: `Bearer ${readerKey}`,
            "content-type": "application/json",
          },
          body: { subject: userId, providerSessionId: payload.sid },
        });
        assert.equal(stateResponse.status, 200);
        const stateText = await stateResponse.text();
        const state = JSON.parse(stateText);
        assert.deepEqual(state, {
          version: 1,
          subject: userId,
          providerSessionId: payload.sid,
          active: true,
          passwordResetState: {
            version: 1,
            kind: "database",
            lastPasswordReset: null,
          },
          operatorCutoff: null,
          securityVersion: 0,
        });
        for (const secret of [
          readerKey,
          password,
          config.secret,
          tx.client.client_secret,
        ])
          assert.equal(stateText.includes(secret), false);

        for (const invalid of [
          { subject: "missing-user", providerSessionId: payload.sid },
          { subject: userId, providerSessionId: "missing-session" },
        ]) {
          const response = await request(statePath, {
            method: "POST",
            headers: {
              authorization: `Bearer ${readerKey}`,
              "content-type": "application/json",
            },
            body: invalid,
          });
          assert.equal(response.status, 200);
          assert.equal((await response.json()).active, false);
        }

        const revokedEmail = "runtime-revoked@example.invalid";
        const revokedPassword = "Runtime-revoked-123";
        const revokedSignup = await providerRequest("/sign-up/email", {
          body: {
            name: "Runtime revoked member",
            email: revokedEmail,
            password: revokedPassword,
          },
        });
        assert.equal(revokedSignup.status, 200);
        const revokedUserId = (await revokedSignup.json()).user.id;
        const revokedCookie = cookies(revokedSignup);
        const beforeRevokeTx = transaction(clients[0]);
        const beforeRevokeCallback = await context.authorize(
          beforeRevokeTx,
          revokedCookie,
        );
        const beforeRevokeTokens = await exchange(
          beforeRevokeTx,
          beforeRevokeCallback.searchParams.get("code"),
        );
        assert.equal(beforeRevokeTokens.status, 200);
        const beforeRevokeJwt = await beforeRevokeTokens.json();
        const beforeRevokeJwks = await (await request("/api/auth/jwks")).json();
        const { payload: beforeRevokeClaims } = await jwtVerify(
          beforeRevokeJwt.id_token,
          createLocalJWKSet(beforeRevokeJwks),
          {
            issuer: "https://accounts.example.test/api/auth",
            audience: beforeRevokeTx.client.client_id,
          },
        );
        assert.equal(beforeRevokeClaims[SECURITY_VERSION_CLAIM], 0);
        assert.equal(beforeRevokeClaims[OPERATOR_CUTOFF_CLAIM], null);
        assert.deepEqual(beforeRevokeClaims[RESET_STATE_CLAIM], {
          version: 1,
          kind: "database",
          lastPasswordReset: null,
        });
        const beforeState = await request(statePath, {
          method: "POST",
          headers: {
            authorization: `Bearer ${readerKey}`,
            "content-type": "application/json",
          },
          body: {
            subject: revokedUserId,
            providerSessionId: beforeRevokeClaims.sid,
          },
        });
        assert.equal(beforeState.status, 200);
        assert.equal((await beforeState.json()).active, true);

        const revokeStarted = Date.now();
        await database.query("SELECT public.aegyo_revoke_user($1,false)", [
          revokedUserId,
        ]);
        const revokeFinished = Date.now();
        const revokedStateResponse = await request(statePath, {
          method: "POST",
          headers: {
            authorization: `Bearer ${readerKey}`,
            "content-type": "application/json",
          },
          body: {
            subject: revokedUserId,
            providerSessionId: beforeRevokeClaims.sid,
          },
        });
        assert.equal(revokedStateResponse.status, 200);
        const revokedState = await revokedStateResponse.json();
        assert.equal(revokedState.active, false);
        assert.equal(revokedState.securityVersion, 1);
        assert.equal(revokedState.passwordResetState.lastPasswordReset, null);
        const operatorCutoff = Date.parse(revokedState.operatorCutoff);
        assert.ok(operatorCutoff >= revokeStarted);
        assert.ok(operatorCutoff <= revokeFinished);

        const freshLogin = await providerRequest("/sign-in/email", {
          body: { email: revokedEmail, password: revokedPassword },
        });
        assert.equal(freshLogin.status, 200);
        const freshTx = transaction(clients[0]);
        const freshCallback = await context.authorize(
          freshTx,
          cookies(freshLogin),
        );
        const freshTokenResponse = await exchange(
          freshTx,
          freshCallback.searchParams.get("code"),
        );
        assert.equal(freshTokenResponse.status, 200);
        const freshTokens = await freshTokenResponse.json();
        const { payload: freshClaims } = await jwtVerify(
          freshTokens.id_token,
          createLocalJWKSet(await (await request("/api/auth/jwks")).json()),
          {
            issuer: "https://accounts.example.test/api/auth",
            audience: freshTx.client.client_id,
          },
        );
        assert.equal(freshClaims.sub, revokedUserId);
        assert.equal(freshClaims[SECURITY_VERSION_CLAIM], 1);
        assert.equal(
          freshClaims[OPERATOR_CUTOFF_CLAIM],
          revokedState.operatorCutoff,
        );
        assert.deepEqual(freshClaims[RESET_STATE_CLAIM], {
          version: 1,
          kind: "database",
          lastPasswordReset: null,
        });

        const raceEmail = "runtime-revoke-race@example.invalid";
        const racePassword = "Runtime-revoke-race-123";
        const raceSignup = await providerRequest("/sign-up/email", {
          body: {
            name: "Runtime revoke race",
            email: raceEmail,
            password: racePassword,
          },
        });
        assert.equal(raceSignup.status, 200);
        const raceUserId = (await raceSignup.json()).user.id;
        let releasePausedLogin;
        const pausedLoginMayFinish = new Promise((resolve) => {
          releasePausedLogin = resolve;
        });
        let markLoginPaused;
        const loginPaused = new Promise((resolve) => {
          markLoginPaused = resolve;
        });
        const { auth: pausedAuth } = createProofProvider({
          ...config,
          proofHooks: {
            beforeSessionInsert: async ({ userId: signingInUserId }) => {
              if (signingInUserId !== raceUserId) return;
              markLoginPaused();
              await pausedLoginMayFinish;
            },
          },
        });
        const pausedLogin = providerRequest("/sign-in/email", {
          provider: pausedAuth,
          body: { email: raceEmail, password: racePassword },
        });
        await loginPaused;
        await database.query("SELECT public.aegyo_revoke_user($1,false)", [
          raceUserId,
        ]);
        releasePausedLogin();
        assert.equal((await pausedLogin).status, 401);

        const { auth: closedAuth } = createAccountsProvider({
          database,
          secret: config.secret,
          legacyPepper: config.legacyPepper,
          baseURL: runtimeConfig.baseURL,
          mail: null,
          signupAllowed: false,
          ipHeader: "x-aegyo-proof-ip",
        });
        const closedServer = createAccountsServer({
          auth: closedAuth,
          database,
          config: { ...runtimeConfig, signupAllowed: false, mail: null },
          readiness: async () => true,
        });
        closedServer.listen(0, "127.0.0.1");
        await once(closedServer, "listening");
        const closedAddress = closedServer.address();
        assert.equal(typeof closedAddress, "object");
        try {
          const response = await fetch(
            `http://127.0.0.1:${closedAddress.port}/api/auth/sign-up/email`,
            {
              method: "POST",
              redirect: "manual",
              headers: {
                origin: runtimeConfig.baseURL,
                "content-type": "application/json",
                "x-aegyo-proof-ip": "198.51.100.250",
              },
              body: JSON.stringify({
                name: "Closed registration",
                email: "closed-registration@example.invalid",
                password: "Closed-registration-123",
              }),
            },
          );
          assert.notEqual(response.status, 200);
        } finally {
          await new Promise((resolve, reject) =>
            closedServer.close((error) => (error ? reject(error) : resolve())),
          );
        }
      } finally {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
  );
}
