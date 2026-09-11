import { test } from "node:test";
import assert from "node:assert/strict";
import {
  inspectMailjetSender,
  readMailjetPreflightConfig,
} from "../src/mailjet-preflight.mjs";

const config = {
  apiKey: "synthetic-public-key",
  secretKey: "synthetic-secret-key",
  from: "accounts@example.invalid",
};
const senderResponse = (Data, extras = {}) =>
  Response.json({ Count: Data.length, Total: Data.length, Data, ...extras });

test("preflight requires an explicit complete credential family and sender", () => {
  const env = {
    MJ_APIKEY_PUBLIC: config.apiKey,
    MJ_APIKEY_PRIVATE: config.secretKey,
    MAIL_FROM: config.from,
  };
  assert.deepEqual(readMailjetPreflightConfig(env, "aegyo"), config);
  assert.throws(() => readMailjetPreflightConfig(env, "accounts"));
  assert.throws(() =>
    readMailjetPreflightConfig({ ...env, MAIL_FROM: "" }, "aegyo"),
  );
  assert.throws(() =>
    readMailjetPreflightConfig({ ...env, MJ_APIKEY_PUBLIC: "a:b" }, "aegyo"),
  );
  assert.throws(() => readMailjetPreflightConfig(env, "unknown"));
});

test("sender inspection performs only one scoped GET and exposes no identities or credentials", async () => {
  const calls = [];
  const report = await inspectMailjetSender(config, async (url, request) => {
    calls.push({ url, request });
    return senderResponse([
      {
        Email: config.from,
        Status: "Active",
        ID: 123,
        ValidationCode: "private",
      },
    ]);
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.origin, "https://api.mailjet.com");
  assert.equal(calls[0].url.pathname, "/v3/REST/sender");
  assert.equal(calls[0].url.searchParams.get("Domain"), "example.invalid");
  assert.equal(calls[0].request.method, "GET");
  assert.equal(calls[0].request.redirect, "error");
  assert.equal(calls[0].request.body, undefined);
  assert.equal(report.senderVerified, true);
  assert.equal(report.readyForDeliveryTest, true);
  assert.equal(report.deliveryVerified, false);
  assert.equal(report.capacityVerified, false);
  for (const value of [...Object.values(config), "ValidationCode", "private"])
    assert.ok(!JSON.stringify(report).includes(value));
});

test("active domain permits its sender but inactive, unrelated and suffix domains do not", async () => {
  const good = await inspectMailjetSender(config, async () =>
    senderResponse([{ Email: "*@example.invalid", Status: "Active" }]),
  );
  assert.equal(good.match, "domain");
  for (const sender of [
    { Email: config.from, Status: "Inactive" },
    { Email: "someone@example.invalid", Status: "Active" },
    { Email: "*@example.invalid.attacker.test", Status: "Active" },
    { Email: "*@attackerexample.invalid", Status: "Active" },
    { Email: {}, Status: "Active" },
    null,
  ]) {
    const report = await inspectMailjetSender(config, async () =>
      senderResponse([sender]),
    );
    assert.equal(report.senderVerified, false);
  }
});

test("provider rejection, malformed/truncated metadata and network errors never leak responses", async () => {
  const secret = config.secretKey;
  const transports = [
    async () => new Response(secret, { status: 401 }),
    async () => new Response(secret, { status: 403 }),
    async () => new Response(secret, { status: 429 }),
    async () => new Response(secret, { status: 302 }),
    async () => new Response(secret),
    async () => new Response("x".repeat(256 * 1024 + 1)),
    async () => senderResponse([], { Total: 101 }),
    async () => senderResponse([], { Count: -1 }),
    async () => Response.json({ Data: [] }),
    async () => {
      throw new Error(secret);
    },
  ];
  for (const transport of transports) {
    const report = await inspectMailjetSender(config, transport);
    assert.equal(report.readyForDeliveryTest, false);
    assert.ok(!JSON.stringify(report).includes(secret));
  }
});
