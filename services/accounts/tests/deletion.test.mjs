import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import pg from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createAccountsProvider } from "../src/provider-core.mjs";
import {
  deletionConfig,
  beginDeletion,
  deletionReceipt,
  preflightDeletion,
  processDeletion,
} from "../src/deletion.mjs";
const participants = Object.fromEntries(
  ["social", "arcade", "daebak"].map((name, i) => [
    name,
    {
      url: `https://${name}.example.test/api/internal/account-deletion`,
      key: String(i).repeat(40),
    },
  ]),
);
const config = deletionConfig(
  {
    ACCOUNTS_DELETION_ENABLED: "true",
    ACCOUNTS_DELETION_PARTICIPANTS_JSON: JSON.stringify(participants),
  },
  "https://accounts.example.test",
);
test("deletion requires three HTTPS participants with separate credentials", () => {
  assert.equal(deletionConfig({}, "https://example.test"), null);
  for (const data of [
    { social: participants.social },
    { ...participants, arcade: participants.social },
  ])
    assert.throws(() =>
      deletionConfig(
        {
          ACCOUNTS_DELETION_ENABLED: "true",
          ACCOUNTS_DELETION_PARTICIPANTS_JSON: JSON.stringify(data),
        },
        "https://example.test",
      ),
    );
});
test("preflight refuses a participant without migration readiness", async () => {
  await assert.rejects(
    preflightDeletion(
      { query: async () => ({ rows: [] }) },
      config,
      async () =>
        new Response(JSON.stringify({ ready: false }), { status: 503 }),
    ),
  );
});
test("ambiguous records do not skip the other products or credential removal", async () => {
  const calls = [];
  const database = {
    query: async (text, args) => {
      calls.push({ text, args });
      if (text.startsWith("UPDATE account_deletion.jobs SET\n"))
        return { rows: [{ id: randomUUID(), subject: "fan", manifest: {} }] };
      return { rows: [] };
    },
  };
  const visited = [];
  await processDeletion(database, config, async (url, options) => {
    visited.push(url);
    const { requestId } = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        requestId,
        status: url.includes("social") ? "needs_review" : "completed",
      }),
    );
  });
  assert.equal(visited.length, 3);
  assert.ok(
    calls.some((c) =>
      c.text.startsWith("SELECT account_deletion.finish_request"),
    ),
  );
});
test("participant failure leaves a durable retry without finalizing", async () => {
  const calls = [];
  const database = {
    query: async (text, args) => {
      calls.push({ text, args });
      return {
        rows: text.startsWith("UPDATE account_deletion.jobs SET\n")
          ? [
              {
                id: randomUUID(),
                subject: "fan",
                manifest: { social: { status: "completed" } },
              },
            ]
          : [],
      };
    },
  };
  let visits = 0;
  await processDeletion(database, config, async () => {
    visits++;
    throw new Error("sensitive secret");
  });
  assert.equal(visits, 1);
  assert.ok(calls.some((c) => c.text.includes("retry_pending")));
  assert.ok(!calls.some((c) => c.text.includes("finish_request")));
  assert.ok(!JSON.stringify(calls).includes("sensitive secret"));
});
test(
  "real provider schema: immediate revocation, restart-safe retries, complete credential removal",
  { skip: process.env.AEGYO_DELETION_PG_TEST !== "1" },
  async (t) => {
    const name = `accounts_delete_${randomUUID().replaceAll("-", "")}`;
    const options = { host: "/tmp", user: userInfo().username };
    const admin = new pg.Pool({ ...options, database: "postgres" });
    await admin.query(`CREATE DATABASE ${name}`);
    const database = new pg.Pool({ ...options, database: name });
    t.after(async () => {
      await database.end();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    });
    const { options: providerOptions } = createAccountsProvider({
      database,
      secret: "s".repeat(48),
      legacyPepper: "synthetic",
      baseURL: "https://accounts.example.test",
    });
    await (await getMigrations(providerOptions)).runMigrations();
    await database.query(
      await readFile(
        new URL("../src/credential-guards.sql", import.meta.url),
        "utf8",
      ),
    );
    await database.query(
      await readFile(
        new URL("../src/deletion-schema.sql", import.meta.url),
        "utf8",
      ),
    );
    await database.query(`INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt","credentialVersion","securityVersion") VALUES('fan','Fan','fan@example.test',true,now(),now(),0,0);
 INSERT INTO "session"(id,token,"userId","expiresAt","createdAt","updatedAt","credentialVersion","securityVersion") VALUES('sid','synthetic-token','fan',now()+interval '1 day',now(),now(),0,0);`);
    const started = await beginDeletion(database, {
      user: { id: "fan" },
      session: { id: "sid" },
    });
    assert.equal((await database.query('SELECT * FROM "session"')).rowCount, 0);
    assert.equal(
      (await database.query('SELECT banned FROM "user"')).rows[0].banned,
      true,
    );
    assert.equal(
      (await deletionReceipt(database, started.token)).status,
      "processing",
    );
    assert.equal(await deletionReceipt(database, "wrong"), null);
    await assert.rejects(
      database.query(
        `INSERT INTO "session"(id,token,"userId","expiresAt","createdAt","updatedAt") VALUES('late','late','fan',now()+interval '1 day',now(),now())`,
      ),
    );
    const visited = [];
    await processDeletion(database, config, async (url, options) => {
      visited.push(url);
      const { requestId } = JSON.parse(options.body);
      return new Response(
        JSON.stringify({
          requestId,
          status: url.includes("social") ? "needs_review" : "completed",
          removed: {},
        }),
      );
    });
    assert.equal(visited.length, 3);
    const receipt = await deletionReceipt(database, started.token);
    assert.equal(receipt.status, "needs_review");
    assert.equal(receipt.policyVersion, "2026-10-20.1");
    assert.equal(receipt.manifest.accounts.status, "completed");
    assert.equal(
      (await database.query('SELECT email FROM "user"')).rows[0].email,
      `deleted-${started.id}@example.invalid`,
    );
    assert.equal(await processDeletion(database, config), false);
  },
);

test("HTTP confirmation requires same origin, explicit consent and recent authentication", async (t) => {
  const { createAccountsServer } = await import("../src/http-server.mjs");
  let current = null;
  let writes = 0;
  const database = {
    query: async (sql) => {
      if (!sql.startsWith("SELECT")) writes++;
      return { rows: [] };
    },
  };
  const auth = {
    handler: async () => new Response("unused"),
    api: { getSession: async () => current },
  };
  const server = createAccountsServer({
    auth,
    database,
    config: { baseURL: "https://accounts.example.test", deletion: config },
    readiness: async () => true,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/account-deletion`;
  const post = (origin, body) =>
    fetch(url, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const accepted = { confirm: true, policyVersion: "2026-10-20.1" };
  assert.equal((await post("https://evil.example", accepted)).status, 403);
  assert.equal((await post("https://accounts.example.test", {})).status, 400);
  assert.equal(
    (await post("https://accounts.example.test", accepted)).status,
    401,
  );
  current = {
    user: { id: "fan" },
    session: { id: "sid", createdAt: new Date(Date.now() - 3600_000) },
  };
  assert.equal(
    (await post("https://accounts.example.test", accepted)).status,
    401,
  );
  assert.equal(
    (
      await fetch(url, {
        headers: { cookie: "__Host-aegyo_deletion=" + "a".repeat(43) },
      })
    ).status,
    404,
  );
  assert.equal(writes, 0);
  const page = await fetch(
    url.replace("/api/account-deletion", "/delete-account?lang=es"),
  );
  assert.equal(page.status, 200);
  assert.match(await page.text(), /lang="es"/);
});
