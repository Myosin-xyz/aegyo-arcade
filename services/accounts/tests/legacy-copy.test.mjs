import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import pg from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createProofProvider } from "../src/proof-provider.mjs";
import { installCredentialGuards } from "../src/credential-guards.mjs";
import { LEGACY_PREFIX } from "../src/passwords.mjs";

const socket = process.env.ACCOUNTS_PROOF_PG_SOCKET;
const pepper = "synthetic-copy-pepper-사랑";
const oldPassword = "Synthetic-copy-password-안녕-123";
const hash = createHash("sha256")
  .update(oldPassword + pepper)
  .digest("hex");

// Design rehearsal only: both the source fixture and destination are inside
// the runner's disposable cluster. This is deliberately not an import CLI.
async function copyFixture(
  database,
  sourceIds,
  { failAfterFirst = false } = {},
) {
  assert.match(database.options.host, /^\/tmp\/aegyo-idp-proof-[A-Za-z0-9]+$/);
  assert.equal(database.options.database, "aegyo_legacy_copy_fixture");
  const client = await database.connect();
  try {
    await client.query("BEGIN");
    // Models the closed target during cutover. The real cross-database freeze
    // and source snapshot protocol still need implementation and review.
    await client.query(
      'LOCK TABLE public."user", copy_journal IN EXCLUSIVE MODE',
    );
    const source = (
      await client.query(
        "SELECT * FROM legacy_fixture WHERE id = ANY($1::text[]) ORDER BY id",
        [sourceIds],
      )
    ).rows;
    assert.equal(new Set(sourceIds).size, sourceIds.length);
    assert.equal(source.length, sourceIds.length);
    const result = [];
    for (const row of source) {
      assert.match(row.password_hash, /^[a-f0-9]{64}$/);
      const alreadyCopied = await client.query(
        "SELECT 1 FROM copy_journal WHERE source_id=$1",
        [row.id],
      );
      if (alreadyCopied.rowCount) throw new Error("source_already_copied");
      const email = row.email.trim().toLowerCase();
      const collision = await client.query(
        'SELECT 1 FROM public."user" WHERE lower(btrim(email))=$1',
        [email],
      );
      if (collision.rowCount)
        throw new Error("email_collision_requires_review");
      const subject = randomUUID();
      await client.query(
        `INSERT INTO public."user"
        (id, name, email, "emailVerified", "createdAt", "updatedAt", role,
         "credentialVersion", "securityVersion")
        VALUES ($1, $2, $3, $4, $5, $5, 'user', 0, 0)`,
        [subject, row.name, email, row.email_verified, row.created_at],
      );
      await client.query(
        `INSERT INTO public."account"
        (id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt")
        VALUES ($1, $2, 'credential', $2, $3, $4, $4)`,
        [
          randomUUID(),
          subject,
          LEGACY_PREFIX + row.password_hash,
          row.created_at,
        ],
      );
      await client.query(
        "INSERT INTO copy_journal(source_id, subject) VALUES ($1,$2)",
        [row.id, subject],
      );
      result.push({ localUserId: row.id, subject });
      if (failAfterFirst) throw new Error("synthetic_copy_failure");
    }
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

test(
  "legacy copy rehearsal preserves ownership and survives failure without credential overwrite",
  { skip: !socket },
  async (t) => {
    assert.match(socket, /^\/tmp\/aegyo-idp-proof-[A-Za-z0-9]+$/);
    const cluster = new pg.Pool({
      host: socket,
      user: userInfo().username,
      database: "postgres",
    });
    await cluster.query("CREATE DATABASE aegyo_legacy_copy_fixture");
    await cluster.end();
    const database = new pg.Pool({
      host: socket,
      user: userInfo().username,
      database: "aegyo_legacy_copy_fixture",
      max: 3,
    });
    t.after(() => database.end());
    const mailbox = [];
    const { auth, options } = createProofProvider({
      database,
      secret: "synthetic-legacy-copy-provider-secret-32-bytes",
      legacyPepper: pepper,
      mailbox,
    });
    const migration = await getMigrations(options);
    await migration.runMigrations();
    await installCredentialGuards(database);
    await database.query(`
      CREATE TABLE legacy_fixture (
        id text PRIMARY KEY, name text NOT NULL, email text NOT NULL,
        email_verified boolean NOT NULL, password_hash text NOT NULL,
        role text NOT NULL, created_at timestamptz NOT NULL
      );
      CREATE TABLE history_fixture (
        id text PRIMARY KEY, owner_id text NOT NULL REFERENCES legacy_fixture(id)
      );
      CREATE TABLE copy_journal (
        source_id text PRIMARY KEY REFERENCES legacy_fixture(id),
        subject text UNIQUE NOT NULL REFERENCES public."user"(id)
      );
      REVOKE ALL ON copy_journal FROM PUBLIC;
    `);
    await database.query(
      `INSERT INTO legacy_fixture VALUES
      ('legacy-owner', 'Synthetic owner', 'owner@example.invalid', true, $1, 'owner', '2026-01-01Z'),
      ('legacy-member', 'Synthetic member', 'member@example.invalid', false, $1, 'user', '2026-01-02Z');
    `,
      [hash],
    );
    await database.query(`INSERT INTO history_fixture VALUES
      ('favorite', 'legacy-member'), ('points', 'legacy-owner')`);
    const snapshot = async () => ({
      users: (await database.query("SELECT * FROM legacy_fixture ORDER BY id"))
        .rows,
      history: (
        await database.query("SELECT * FROM history_fixture ORDER BY id")
      ).rows,
    });
    const before = await snapshot();
    const counts = async () =>
      (
        await database.query(`SELECT
      (SELECT count(*)::int FROM public."user") AS users,
      (SELECT count(*)::int FROM public."account") AS credentials,
      (SELECT count(*)::int FROM copy_journal) AS mappings`)
      ).rows[0];

    await t.test(
      "partial failure rolls back users, credentials and journal together",
      async () => {
        await assert.rejects(
          copyFixture(database, ["legacy-owner", "legacy-member"], {
            failAfterFirst: true,
          }),
          /synthetic_copy_failure/,
        );
        assert.deepEqual(await counts(), {
          users: 0,
          credentials: 0,
          mappings: 0,
        });
        assert.deepEqual(await snapshot(), before);
      },
    );

    const pairs = await copyFixture(database, [
      "legacy-owner",
      "legacy-member",
    ]);
    const pair = (id) => pairs.find((item) => item.localUserId === id);
    let ip = 0;
    const request = (path, body) =>
      auth.handler(
        new Request("https://accounts.example.test/api/auth" + path, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://accounts.example.test",
            "x-aegyo-proof-ip": `192.0.2.${++ip}`,
          },
          body: JSON.stringify(body),
        }),
      );

    await t.test(
      "copied hashes authenticate the same explicit identities without importing owner privileges",
      async () => {
        assert.deepEqual(await counts(), {
          users: 2,
          credentials: 2,
          mappings: 2,
        });
        for (const source of before.users) {
          const response = await request("/sign-in/email", {
            email: source.email,
            password: oldPassword,
          });
          assert.equal(response.status, 200);
          const user = (await response.json()).user;
          assert.equal(user.id, pair(source.id).subject);
          assert.notEqual(user.id, source.id);
          assert.equal(user.emailVerified, source.email_verified);
          assert.equal(user.role, "user");
        }
        assert.deepEqual(await snapshot(), before);
      },
    );

    await t.test(
      "normalized-email collision never links a second source identity",
      async () => {
        await database.query(
          `INSERT INTO legacy_fixture VALUES
        ('legacy-conflict','Synthetic conflict',' OWNER@example.invalid ',false,$1,'user',now())`,
          [hash],
        );
        await assert.rejects(
          copyFixture(database, ["legacy-conflict"]),
          /email_collision_requires_review/,
        );
        assert.deepEqual(await counts(), {
          users: 2,
          credentials: 2,
          mappings: 2,
        });
        await database.query(
          "DELETE FROM legacy_fixture WHERE id='legacy-conflict'",
        );
      },
    );

    await t.test(
      "re-running the copy after password recovery cannot restore an old password",
      async () => {
        const email = "member@example.invalid";
        const newPassword = "Synthetic-after-copy-reset-987";
        assert.equal(
          (await request("/request-password-reset", { email })).status,
          200,
        );
        assert.equal(mailbox.length, 1);
        assert.equal(
          (
            await request("/reset-password", {
              token: mailbox[0].token,
              newPassword,
            })
          ).status,
          200,
        );
        const stored = async () =>
          (
            await database.query(
              `SELECT password FROM public."account"
        WHERE "userId"=$1 AND "providerId"='credential'`,
              [pair("legacy-member").subject],
            )
          ).rows[0].password;
        const afterReset = await stored();
        assert.ok(!afterReset.startsWith(LEGACY_PREFIX));
        await assert.rejects(
          copyFixture(database, ["legacy-member"]),
          /source_already_copied/,
        );
        assert.equal(await stored(), afterReset);
        assert.equal(
          (await request("/sign-in/email", { email, password: oldPassword }))
            .status,
          401,
        );
        assert.equal(
          (await request("/sign-in/email", { email, password: newPassword }))
            .status,
          200,
        );
        assert.deepEqual(await counts(), {
          users: 2,
          credentials: 2,
          mappings: 2,
        });
        assert.deepEqual(await snapshot(), before);
      },
    );
  },
);
