import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";

const socket = process.env.ACCOUNTS_PROOF_PG_SOCKET;

test(
  "snapshots actual Aegyo ownership shapes and row content from PostgreSQL",
  { skip: !socket },
  async (t) => {
    assert.match(socket, /^\/tmp\/aegyo-idp-proof-[A-Za-z0-9]+$/);
    const databaseName = `aegyo_snapshot_${randomUUID().replaceAll("-", "")}`;
    const cluster = new pg.Pool({
      host: socket,
      user: userInfo().username,
      database: "postgres",
    });
    await cluster.query(`CREATE DATABASE ${databaseName}`);
    await cluster.end();
    const database = new pg.Pool({
      host: socket,
      user: userInfo().username,
      database: databaseName,
    });
    t.after(() => database.end());
    await database.query(`
      CREATE TABLE "User" (id text PRIMARY KEY, role text);
      CREATE TABLE "Session" (id text PRIMARY KEY, "userId" text NOT NULL, token text NOT NULL);
      CREATE TABLE "Favorite" (id text PRIMARY KEY, "userId" text NOT NULL, value text NOT NULL);
      CREATE TABLE "Comment" (id text PRIMARY KEY, "userId" text NOT NULL, body text NOT NULL);
      CREATE TABLE "SuggestedEdit" (id text PRIMARY KEY, "userId" text NOT NULL, body text NOT NULL);
      CREATE TABLE "SlangVote" (id text PRIMARY KEY, "userId" text NOT NULL, vote text NOT NULL);
      CREATE TABLE "Follow" (id text PRIMARY KEY, "followerId" text NOT NULL, "targetSlug" text NOT NULL);
      CREATE TABLE "PollVote" (id text PRIMARY KEY, "pollSlug" text NOT NULL, "option" text NOT NULL,
        "voterRef" text NOT NULL, "voterType" text NOT NULL, flags text);
      INSERT INTO "User" VALUES ('member-a','moderator'),('member-b','user');
      INSERT INTO "Session" VALUES ('session-a','member-a','secret-token');
      INSERT INTO "Favorite" VALUES ('favorite-a','member-a','artist-a');
      INSERT INTO "Comment" VALUES ('comment-a','member-a','original');
      INSERT INTO "SuggestedEdit" VALUES ('edit-b','member-b','correction');
      INSERT INTO "SlangVote" VALUES ('slang-b','member-b','up');
      INSERT INTO "Follow" VALUES ('follow-a','member-a','member-b-profile');
      INSERT INTO "PollVote" VALUES
        ('poll-profile','poll-a','yes','member-a','profile',NULL),
        ('poll-device','poll-a','no','opaque-device','device',NULL);
    `);
    const directory = await mkdtemp(join(tmpdir(), "aegyo-local-snapshot-"));
    const snapshot = async (name) => {
      const output = join(directory, `${name}.json`);
      const env = {
        ...process.env,
        ACCOUNTS_PROOF_PG_SOCKET: socket,
        REHEARSAL_LEGACY_OWNER_DATABASE_URL: `postgresql://${userInfo().username}@localhost/${databaseName}?host=${encodeURIComponent(socket)}`,
        REHEARSAL_LEGACY_DATABASE_NAME: databaseName,
        ACCOUNTS_REAL_LOCAL_STATE_OUTPUT: output,
      };
      delete env.DATABASE_URL;
      delete env.REHEARSAL_DATABASE_CA_CERT;
      delete env.REHEARSAL_DATABASE_SERVER_SHA256;
      const result = spawnSync(
        process.execPath,
        ["scripts/snapshot-aegyo-local-state.mjs"],
        { cwd: new URL("..", import.meta.url), env, encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.doesNotMatch(await readFile(output, "utf8"), /secret-token/);
      return JSON.parse(await readFile(output, "utf8"));
    };
    const before = await snapshot("before");
    const memberA = before.users.find((user) => user.id === "member-a");
    assert.deepEqual(memberA.linkedRecords, {
      Session: ["session-a"],
      Favorite: ["favorite-a"],
      Comment: ["comment-a"],
      SuggestedEdit: [],
      SlangVote: [],
      Follow: ["follow-a"],
      PollVote: ["poll-profile"],
    });
    assert.deepEqual(before.anonymousPollVotes.ids, ["poll-device"]);
    assert.doesNotMatch(JSON.stringify(before), /opaque-device/);
    await database.query(
      `UPDATE "Follow" SET "targetSlug"='changed-profile' WHERE id='follow-a'`,
    );
    const after = await snapshot("after");
    const afterA = after.users.find((user) => user.id === "member-a");
    assert.deepEqual(afterA.linkedRecords.Follow, ["follow-a"]);
    assert.notEqual(
      afterA.linkedRecordDigests.Follow,
      memberA.linkedRecordDigests.Follow,
    );
    await database.query('DROP TABLE "SlangVote"');
    const refusedOutput = join(directory, "refused.json");
    const refusal = spawnSync(
      process.execPath,
      ["scripts/snapshot-aegyo-local-state.mjs"],
      {
        cwd: new URL("..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          ACCOUNTS_PROOF_PG_SOCKET: socket,
          REHEARSAL_LEGACY_OWNER_DATABASE_URL: `postgresql://${userInfo().username}@localhost/${databaseName}?host=${encodeURIComponent(socket)}`,
          REHEARSAL_LEGACY_DATABASE_NAME: databaseName,
          ACCOUNTS_REAL_LOCAL_STATE_OUTPUT: refusedOutput,
        },
      },
    );
    assert.equal(refusal.status, 1);
    assert.match(refusal.stderr, /linked_table_missing_or_ambiguous/);
  },
);
