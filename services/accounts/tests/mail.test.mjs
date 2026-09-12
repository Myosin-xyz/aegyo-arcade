import { test } from "node:test";
import assert from "node:assert/strict";
import { createMailSender } from "../src/mail.mjs";
import { readConfig } from "../src/config.mjs";

const origin = "https://accounts.example.test";
const config = {
  provider: "resend",
  apiKey: "synthetic-key",
  from: "accounts@example.invalid",
};
const message = {
  user: { email: "member@example.invalid" },
  url: `${origin}/reset-password?token=synthetic-token`,
};
const success = () =>
  Response.json({ id: "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794" });

test("Resend configuration is explicit and does not require or reuse Mailjet credentials", () => {
  const env = {
    ACCOUNTS_ENVIRONMENT: "staging",
    ACCOUNTS_BASE_URL: origin,
    DATABASE_URL: "postgres://proof:synthetic@localhost/proof",
    BETTER_AUTH_SECRET: "s".repeat(48),
    ACCOUNTS_LEGACY_PEPPER: "synthetic",
    ACCOUNTS_STATE_READERS_JSON: JSON.stringify({ arcade: "a".repeat(48) }),
    ACCOUNTS_MAIL_MODE: "resend",
    RESEND_API_KEY: config.apiKey,
    RESEND_FROM_EMAIL: config.from,
  };
  assert.deepEqual(readConfig(env).mail, config);
  assert.equal(readConfig(env).signupAllowed, false);
  assert.throws(() => readConfig({ ...env, RESEND_API_KEY: "" }));
  assert.throws(() =>
    readConfig({ ...env, RESEND_FROM_EMAIL: "Name <member@example.invalid>" }),
  );
  assert.throws(() => readConfig({ ...env, ACCOUNTS_MAIL_MODE: "unknown" }));
});

test("Resend uses the verified sender contract and stable opaque retry keys", async () => {
  const calls = [];
  const sender = createMailSender(config, origin, async (url, request) => {
    calls.push({ url, request });
    return success();
  });
  await sender("reset", message);
  await sender("reset", message);
  await sender("reset", {
    ...message,
    url: `${origin}/reset-password?token=another-token`,
  });
  const first = calls[0];
  assert.equal(first.url, "https://api.resend.com/emails");
  assert.equal(first.request.headers.authorization, `Bearer ${config.apiKey}`);
  assert.equal(first.request.redirect, "error");
  assert.ok(first.request.signal);
  const body = JSON.parse(first.request.body);
  assert.equal(body.from, `Aegyo Arena <${config.from}>`);
  assert.deepEqual(body.to, [message.user.email]);
  assert.ok(body.text.includes(message.url));
  const key = first.request.headers["idempotency-key"];
  assert.equal(key, calls[1].request.headers["idempotency-key"]);
  assert.notEqual(key, calls[2].request.headers["idempotency-key"]);
  assert.ok(
    !key.includes(message.user.email) && !key.includes("synthetic-token"),
  );
});

test("blocked, throttled, malformed, redirected and oversized mail responses fail without disclosing credentials or links", async () => {
  const privateText = `${config.apiKey} ${message.url}`;
  const transports = [
    async () => new Response(privateText, { status: 401 }),
    async () => new Response(privateText, { status: 429 }),
    async () => new Response(privateText, { status: 307 }),
    async () => Response.json({ error: privateText }),
    async () => Response.json({ id: "not-a-message-id" }),
    async () => new Response("x".repeat(64 * 1024 + 1)),
    async () => {
      throw new Error(privateText);
    },
  ];
  for (const transport of transports) {
    await assert.rejects(
      createMailSender(config, origin, transport)("reset", message),
      (error) => {
        assert.equal(error.message, "Account email delivery failed");
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
});

test("invalid links and email kinds never reach either provider", async () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    return success();
  };
  for (const provider of ["mailjet", "resend"]) {
    const sender = createMailSender({ ...config, provider }, origin, transport);
    for (const url of [
      "not a URL",
      "https://evil.example/reset",
      "https://user:password@accounts.example.test/reset",
    ]) {
      await assert.rejects(sender("reset", { ...message, url }));
    }
    await assert.rejects(sender("unknown", message));
  }
  assert.equal(calls, 0);
  assert.equal(createMailSender(null, origin), null);
  assert.throws(() =>
    createMailSender({ ...config, provider: "unknown" }, origin),
  );
});
