import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig, clientIP } from "../src/config.mjs";
import { authorizedReader } from "../src/security-state.mjs";
import { createMailSender } from "../src/mail.mjs";
import {
  registeredContinuation,
  createAccountsServer,
} from "../src/http-server.mjs";

const baseEnv = {
  ACCOUNTS_ENVIRONMENT: "staging",
  ACCOUNTS_BASE_URL: "https://accounts.example.test",
  DATABASE_URL: "postgres://app:synthetic@localhost/accounts",
  BETTER_AUTH_SECRET: "s".repeat(48),
  ACCOUNTS_LEGACY_PEPPER: "synthetic",
  ACCOUNTS_STATE_READERS_JSON: JSON.stringify({ arcade: "a".repeat(48) }),
};

test("runtime defaults keep signup closed; production requires verified proxy and configured mail", () => {
  const config = readConfig(baseEnv);
  assert.equal(config.signupAllowed, false);
  assert.equal(config.mail, null);
  assert.equal(config.ipMode, "socket");
  for (const override of [
    { ACCOUNTS_BASE_URL: "https://accounts.example.test/?attacker=1" },
    { ACCOUNTS_BASE_URL: "http://accounts.example.test" },
    { ACCOUNTS_SIGNUP_ENABLED: "true" },
    { ACCOUNTS_CLIENT_IP_MODE: "railway-x-real-ip" },
    { ACCOUNTS_ENVIRONMENT: "production" },
    { BETTER_AUTH_SECRET: "" },
    { ACCOUNTS_LEGACY_PEPPER: "" },
    { ACCOUNTS_STATE_READERS_JSON: JSON.stringify({ arcade: "short" }) },
  ])
    assert.throws(() => readConfig({ ...baseEnv, ...override }));
});

test("caller-supplied IP headers cannot bypass socket mode or malformed trusted header handling", () => {
  const req = {
    headers: {
      "x-real-ip": "198.51.100.2",
      "x-aegyo-client-ip": "203.0.113.9",
    },
    socket: { remoteAddress: "127.0.0.1" },
  };
  assert.equal(clientIP(req, "socket"), "127.0.0.1");
  assert.equal(clientIP(req, "railway-x-real-ip"), "198.51.100.2");
  req.headers["x-real-ip"] = "1.2.3.4, 5.6.7.8";
  assert.equal(clientIP(req, "railway-x-real-ip"), "unknown");
});

test("security-state requires a distinct configured bearer credential", () => {
  const readers = { arcade: "a".repeat(48), daebak: "d".repeat(48) };
  assert.equal(authorizedReader(undefined, readers), false);
  assert.equal(authorizedReader("Bearer " + "x".repeat(48), readers), false);
  assert.equal(authorizedReader("Bearer " + readers.arcade, readers), true);
  assert.equal(authorizedReader("Bearer " + readers.daebak, readers), true);
});

test("email sends only provider-origin links and rejects an accepted HTTP response with failed message status", async () => {
  let sent;
  const sender = createMailSender(
    {
      apiKey: "synthetic",
      secretKey: "synthetic",
      from: "accounts@example.invalid",
    },
    baseEnv.ACCOUNTS_BASE_URL,
    async (url, request) => {
      sent = { url, request };
      return Response.json({ Messages: [{ Status: "success" }] });
    },
  );
  const message = {
    url: "https://accounts.example.test/api/auth/reset-password/test-token",
    user: { email: "member@example.invalid" },
  };
  await sender("reset", message);
  assert.equal(sent.url, "https://api.mailjet.com/v3.1/send");
  assert.equal(
    JSON.parse(sent.request.body).Messages[0].To[0].Email,
    message.user.email,
  );
  await assert.rejects(
    sender("reset", { ...message, url: "https://evil.example/link" }),
  );
  const failed = createMailSender(
    { apiKey: "a", secretKey: "b", from: "accounts@example.invalid" },
    baseEnv.ACCOUNTS_BASE_URL,
    async () => Response.json({ Messages: [{ Status: "error" }] }),
  );
  await assert.rejects(failed("reset", message));
});

test("continuation permits only an exact registered callback and a same-origin authorize resume", async () => {
  const database = {
    query: async () => ({
      rows: [
        {
          redirectUris: ["https://arcade.example.test/callback"],
          disabled: false,
        },
      ],
    }),
  };
  const query = new URLSearchParams({
    client_id: "arcade",
    redirect_uri: "https://arcade.example.test/callback",
    sig: "unverified-provider-verifies-on-submit",
    max_age: "0",
  });
  const accepted = await registeredContinuation(
    database,
    baseEnv.ACCOUNTS_BASE_URL,
    new URL(`${baseEnv.ACCOUNTS_BASE_URL}/sign-in?${query}`),
  );
  assert.equal(
    accepted.trustedRedirectUri,
    "https://arcade.example.test/callback",
  );
  assert.equal(new URLSearchParams(accepted.oauthQuery).get("max_age"), "0");
  query.set("redirect_uri", "https://attacker.example/callback");
  assert.deepEqual(
    await registeredContinuation(
      database,
      baseEnv.ACCOUNTS_BASE_URL,
      new URL(`${baseEnv.ACCOUNTS_BASE_URL}/sign-in?${query}`),
    ),
    {},
  );
  assert.deepEqual(
    await registeredContinuation(
      database,
      baseEnv.ACCOUNTS_BASE_URL,
      new URL(
        `${baseEnv.ACCOUNTS_BASE_URL}/sign-in?continue=https://evil.example/api/auth/oauth2/authorize`,
      ),
    ),
    {},
  );
});

test("HTTP liveness survives database failure but readiness and account routes fail closed", async (t) => {
  const auth = {
    handler: async () => {
      throw new Error("must not call auth");
    },
  };
  const server = createAccountsServer({
    auth,
    database: {},
    config: readConfig(baseEnv),
    readiness: async () => false,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/healthz`)).status, 200);
  assert.equal((await fetch(`${origin}/readyz`)).status, 503);
  assert.equal((await fetch(`${origin}/sign-in`)).status, 503);
});
