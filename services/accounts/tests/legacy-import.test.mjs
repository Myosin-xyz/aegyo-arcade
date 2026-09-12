import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { userInfo } from "node:os";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  stat,
  rm,
  chmod,
  writeFile,
} from "node:fs/promises";
import pg from "pg";
import { getMigrations } from "better-auth/db/migration";
import { createProofProvider } from "../src/proof-provider.mjs";
import { installCredentialGuards } from "../src/credential-guards.mjs";
import {
  validateSnapshot,
  captureLegacySnapshot,
  installImportJournal,
  applyLegacySnapshot as applyWithProof,
  verifyCredentialProof,
  inspectImport,
  MAX_IMPORT_ARTIFACT_BYTES,
  serializeImportArtifact,
} from "../src/legacy-import.mjs";

const socket = process.env.ACCOUNTS_PROOF_PG_SOCKET;
const pepper = "synthetic-operator-import-pepper";
const password = "Synthetic-import-password-안녕-123";
const hash = createHash("sha256")
  .update(password + pepper)
  .digest("hex");
const fixture = {
  version: 1,
  source: "aegyo-legacy",
  sourceNamespace: "synthetic/railway/aegyo-production",
  sourceDatabase: "aegyo_import_source",
  issuer: "https://accounts.example.test/api/auth",
  count: 2,
  users: [
    {
      id: "member-1",
      email: "one@example.invalid",
      name: "One",
      emailVerified: false,
      passwordHash: hash,
      createdAt: "2026-01-01T00:00:00Z",
    },
    {
      id: "owner-2",
      email: "two@example.invalid",
      name: null,
      emailVerified: true,
      passwordHash: hash,
      createdAt: "2026-01-02T00:00:00Z",
    },
  ],
};
const approved = validateSnapshot(fixture);
test("private artifact size boundary counts UTF-8 bytes including the trailing newline", () => {
  const overhead = Buffer.byteLength(JSON.stringify({ pad: "" }) + "\n");
  const size = MAX_IMPORT_ARTIFACT_BYTES - overhead;
  const pad = "é".repeat(Math.floor(size / 2)) + "a".repeat(size % 2);
  assert.equal(
    Buffer.byteLength(serializeImportArtifact({ pad })),
    MAX_IMPORT_ARTIFACT_BYTES,
  );
  assert.throws(
    () => serializeImportArtifact({ pad: pad + "a" }),
    /import_artifact_too_large/,
  );
});
const credentialProof = {
  legacyPepper: pepper,
  sourceUserId: fixture.users[0].id,
  password,
  deployedPepperDigest: createHash("sha256").update(pepper).digest("hex"),
};
const applyLegacySnapshot = (client, input, expectedDigest) =>
  applyWithProof(client, input, expectedDigest, credentialProof);

test("credential proof requires a known source password and reviewed deployed pepper fingerprint", () => {
  assert.doesNotThrow(() =>
    verifyCredentialProof(approved.snapshot, credentialProof),
  );
  assert.throws(
    () => verifyCredentialProof(approved.snapshot, undefined),
    /credential_proof_required/,
  );
  assert.throws(
    () =>
      verifyCredentialProof(approved.snapshot, {
        ...credentialProof,
        legacyPepper: "wrong-pepper",
      }),
    /deployed_pepper_mismatch/,
  );
  assert.throws(
    () =>
      verifyCredentialProof(approved.snapshot, {
        ...credentialProof,
        password: "wrong-password",
      }),
    /legacy_canary_password_mismatch/,
  );
  assert.throws(
    () =>
      verifyCredentialProof(approved.snapshot, {
        ...credentialProof,
        sourceUserId: "missing",
      }),
    /legacy_canary_password_mismatch/,
  );
});

test("operator importer validates complete populations and exact issuer before touching a database", () => {
  for (const changed of [
    { count: 1 },
    { issuer: "https://accounts.example.test/" },
    { issuer: "https://accounts.example.test" },
    { issuer: "https://accounts.example.test/api/auth/" },
    { issuer: "http://accounts.example.test" },
    { users: [fixture.users[0], fixture.users[0]] },
    {
      users: [
        fixture.users[0],
        { ...fixture.users[1], email: " ONE@example.invalid " },
      ],
    },
    {
      users: [
        fixture.users[0],
        { ...fixture.users[1], passwordHash: "!external!" },
      ],
    },
  ])
    assert.throws(() => validateSnapshot({ ...fixture, ...changed }));
  assert.equal(
    validateSnapshot({ ...fixture, users: [...fixture.users].reverse() })
      .snapshotDigest,
    approved.snapshotDigest,
  );
});

test(
  "real operator importer journals atomic ownership and never replays credentials",
  { skip: !socket },
  async (t) => {
    assert.match(socket, /^\/tmp\/aegyo-idp-proof-[A-Za-z0-9]+$/);
    const options = { host: socket, user: userInfo().username, max: 3 };
    const cluster = new pg.Pool({ ...options, database: "postgres" });
    await cluster.query("CREATE DATABASE aegyo_import_source");
    await cluster.query("CREATE DATABASE aegyo_import_target");
    await cluster.query(
      "CREATE ROLE aegyo_import_runtime LOGIN NOSUPERUSER NOCREATEROLE NOBYPASSRLS",
    );
    await cluster.end();
    const source = new pg.Pool({ ...options, database: "aegyo_import_source" });
    const target = new pg.Pool({ ...options, database: "aegyo_import_target" });
    const app = new pg.Pool({
      ...options,
      database: "aegyo_import_target",
      user: "aegyo_import_runtime",
    });
    let operator;
    t.after(async () => {
      operator?.release();
      await source.end();
      await target.end();
      await app.end();
    });
    const mailbox = [];
    const { auth, options: providerOptions } = createProofProvider({
      database: target,
      secret: "synthetic-operator-provider-secret-32-bytes",
      legacyPepper: pepper,
      mailbox,
    });
    await (await getMigrations(providerOptions)).runMigrations();
    const discovery = await auth.handler(
      new Request(
        "https://accounts.example.test/api/auth/.well-known/openid-configuration",
      ),
    );
    assert.equal(discovery.status, 200);
    assert.equal((await discovery.json()).issuer, fixture.issuer);
    await installCredentialGuards(target);
    await target.query(
      "CREATE TABLE public.aegyo_schema_version(version integer); INSERT INTO public.aegyo_schema_version VALUES (1)",
    );
    operator = await target.connect();
    await installImportJournal(operator, "aegyo_import_runtime");
    await source.query(`CREATE TABLE public."User" (
    id text PRIMARY KEY, email text NOT NULL, "displayName" text,
    "emailVerified" boolean NOT NULL, "passwordHash" text NOT NULL, "createdAt" timestamptz NOT NULL,
    role text NOT NULL DEFAULT 'owner');
    CREATE TABLE history(id text PRIMARY KEY, owner text REFERENCES public."User"(id));`);
    for (const user of fixture.users)
      await source.query(
        'INSERT INTO public."User" VALUES ($1,$2,$3,$4,$5,$6)',
        [
          user.id,
          user.email,
          user.name,
          user.emailVerified,
          user.passwordHash,
          user.createdAt,
        ],
      );
    await source.query(
      "INSERT INTO history VALUES ('existing-favorite','member-1')",
    );
    const sourceBefore = (
      await source.query('SELECT * FROM public."User" ORDER BY id')
    ).rows;
    const counts = async () =>
      (
        await target.query(`SELECT
    (SELECT count(*)::int FROM public."user") AS users,
    (SELECT count(*)::int FROM public."account") AS credentials,
    (SELECT count(*)::int FROM aegyo_import.identities) AS mappings,
    (SELECT count(*)::int FROM aegyo_import.batches) AS batches`)
      ).rows[0];
    const empty = { users: 0, credentials: 0, mappings: 0, batches: 0 };
    await t.test(
      "source capture is complete, read-only, and pins the source database",
      async () => {
        const reader = await source.connect();
        try {
          assert.deepEqual(
            await captureLegacySnapshot(reader, fixture),
            approved,
          );
          await assert.rejects(
            captureLegacySnapshot(reader, {
              ...fixture,
              sourceDatabase: "wrong",
            }),
            /source_database_mismatch/,
          );
        } finally {
          reader.release();
        }
        assert.deepEqual(
          (await source.query('SELECT * FROM public."User" ORDER BY id')).rows,
          sourceBefore,
        );
      },
    );
    await t.test(
      "runtime cannot read or modify journal and reinstall refuses",
      async () => {
        await assert.rejects(
          app.query("SELECT * FROM aegyo_import.identities"),
          { code: "42501" },
        );
        await assert.rejects(
          installImportJournal(operator, "aegyo_import_runtime"),
          /journal_already_exists/,
        );
      },
    );
    await t.test(
      "unapproved digest and normalized target collision abort without linking",
      async () => {
        await assert.rejects(
          applyLegacySnapshot(operator, fixture, "0".repeat(64)),
          /digest_mismatch/,
        );
        await target.query(`INSERT INTO public."user" (id,name,email,"emailVerified","createdAt","updatedAt","credentialVersion","securityVersion")
      VALUES ('collision','Other',' ONE@example.invalid ',true,now(),now(),0,0)`);
        await assert.rejects(
          applyLegacySnapshot(operator, fixture, approved.snapshotDigest),
          /email_collision_requires_review/,
        );
        assert.equal((await counts()).mappings, 0);
        await target.query(`DELETE FROM public."user" WHERE id='collision'`);
        assert.deepEqual(await counts(), empty);
      },
    );
    await t.test(
      "database failure after first user rolls back every identity and journal row",
      async () => {
        await target.query(`CREATE FUNCTION public.synthetic_import_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.email='two@example.invalid' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER synthetic_import_failure BEFORE INSERT ON public."user" FOR EACH ROW EXECUTE FUNCTION public.synthetic_import_failure()`);
        await assert.rejects(
          applyLegacySnapshot(operator, fixture, approved.snapshotDigest),
        );
        assert.deepEqual(await counts(), empty);
        await target.query(
          'DROP TRIGGER synthetic_import_failure ON public."user"; DROP FUNCTION public.synthetic_import_failure()',
        );
      },
    );
    let pairs;
    await t.test(
      "lost commit acknowledgement is recovered from journal without duplicate users",
      async () => {
        const droppedAcknowledgement = {
          query: async (...args) => {
            const result = await operator.query(...args);
            if (args[0] === "COMMIT")
              throw new Error("synthetic dropped connection after commit");
            return result;
          },
        };
        await assert.rejects(
          applyLegacySnapshot(
            droppedAcknowledgement,
            fixture,
            approved.snapshotDigest,
          ),
          /commit_outcome_unknown/,
        );
        pairs = await inspectImport(operator, fixture, approved.snapshotDigest);
        assert.equal(pairs.length, 2);
        const second = await target.connect();
        try {
          const repeats = await Promise.all(
            [operator, second].map((client) =>
              applyLegacySnapshot(client, fixture, approved.snapshotDigest),
            ),
          );
          for (const repeated of repeats) {
            assert.equal(repeated.alreadyCommitted, true);
            assert.deepEqual(repeated.pairs, pairs);
          }
        } finally {
          second.release();
        }
        assert.deepEqual(await counts(), {
          users: 2,
          credentials: 2,
          mappings: 2,
          batches: 1,
        });
      },
    );
    let ip = 10;
    const request = (path, body) =>
      auth.handler(
        new Request(`https://accounts.example.test/api/auth${path}`, {
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
      "actual sign-in maps every imported identity without importing product owner roles",
      async () => {
        for (const user of fixture.users) {
          const response = await request("/sign-in/email", {
            email: user.email,
            password,
          });
          assert.equal(response.status, 200);
          const result = (await response.json()).user;
          assert.equal(
            result.id,
            pairs.find((pair) => pair.localUserId === user.id).subject,
          );
          assert.equal(result.role, "user");
          assert.equal(result.emailVerified, user.emailVerified);
        }
      },
    );
    await t.test(
      "post-recovery exact retry does not overwrite the new password or security state",
      async () => {
        const email = fixture.users[0].email;
        assert.equal(
          (await request("/request-password-reset", { email })).status,
          200,
        );
        const newPassword = "Synthetic-recovered-operator-password-456";
        assert.equal(
          (
            await request("/reset-password", {
              token: mailbox[0].token,
              newPassword,
            })
          ).status,
          200,
        );
        const snapshotState = async () =>
          (
            await target.query(
              `SELECT a.password, u."passwordChangedAt", u."securityVersion", u."credentialVersion"
      FROM public."user" u JOIN public."account" a ON a."userId"=u.id WHERE u.email=$1`,
              [email],
            )
          ).rows;
        const before = await snapshotState();
        assert.equal(
          (
            await applyLegacySnapshot(
              operator,
              fixture,
              approved.snapshotDigest,
            )
          ).alreadyCommitted,
          true,
        );
        assert.deepEqual(await snapshotState(), before);
        assert.equal(
          (await request("/sign-in/email", { email, password })).status,
          401,
        );
        assert.equal(
          (await request("/sign-in/email", { email, password: newPassword }))
            .status,
          200,
        );
        const changed = validateSnapshot({
          ...fixture,
          users: fixture.users.map((row) => ({
            ...row,
            name: "Changed source name",
          })),
        });
        await assert.rejects(
          applyLegacySnapshot(
            operator,
            changed.snapshot,
            changed.snapshotDigest,
          ),
          /source_changed_after_import/,
        );
        const renamed = validateSnapshot({
          ...fixture,
          sourceNamespace: "another-source",
        });
        await assert.rejects(
          applyLegacySnapshot(
            operator,
            renamed.snapshot,
            renamed.snapshotDigest,
          ),
          /different_source_already_imported/,
        );
        assert.deepEqual(await snapshotState(), before);
      },
    );
    await t.test(
      "operator CLI writes private mappings, refuses source drift, and does not log identities",
      async () => {
        const directory = await mkdtemp(
          new URL("../.proof/import-cli-", import.meta.url).pathname,
        );
        t.after(() => rm(directory, { recursive: true, force: true }));
        const url = (name) =>
          `postgresql://${userInfo().username}@localhost/${name}?host=${encodeURIComponent(socket)}`;
        await writeFile(
          `${directory}/credential-proof.json`,
          JSON.stringify({
            sourceUserId: credentialProof.sourceUserId,
            password,
            deployedPepperDigest: credentialProof.deployedPepperDigest,
          }),
          { mode: 0o600 },
        );
        const environment = {
          ...process.env,
          ACCOUNTS_IMPORT_SOURCE_DATABASE_URL: url("aegyo_import_source"),
          ACCOUNTS_IMPORT_SOURCE_DATABASE_NAME: "aegyo_import_source",
          ACCOUNTS_IMPORT_SOURCE_NAMESPACE: fixture.sourceNamespace,
          ACCOUNTS_IMPORT_TARGET_DATABASE_URL: url("aegyo_import_target"),
          ACCOUNTS_IMPORT_TARGET_DATABASE_NAME: "aegyo_import_target",
          ACCOUNTS_IMPORT_ISSUER: fixture.issuer,
          ACCOUNTS_IMPORT_APPROVED_DIGEST: approved.snapshotDigest,
          ACCOUNTS_IMPORT_EXPECTED_COUNT: "2",
          ACCOUNTS_LEGACY_PEPPER: pepper,
          ACCOUNTS_IMPORT_CREDENTIAL_PROOF: `${directory}/credential-proof.json`,
          ACCOUNTS_IMPORT_INPUT: `${directory}/snapshot.json`,
          ACCOUNTS_IMPORT_OUTPUT: `${directory}/snapshot.json`,
          ACCOUNTS_IMPORT_CONFIRM: "read-only-private-source-snapshot",
        };
        delete environment.DATABASE_URL;
        const run = (command, overrides = {}) => {
          const result = spawnSync(
            process.execPath,
            ["scripts/import-legacy.mjs", command],
            {
              cwd: new URL("..", import.meta.url),
              env: { ...environment, ...overrides },
              encoding: "utf8",
              timeout: 15000,
            },
          );
          for (const value of [
            hash,
            password,
            pepper,
            fixture.users[0].email,
            fixture.users[1].email,
            url("aegyo_import_source"),
          ])
            assert.ok(!(result.stdout + result.stderr).includes(value));
          return result;
        };
        assert.equal(run("snapshot").status, 0);
        assert.equal(
          (await stat(environment.ACCOUNTS_IMPORT_INPUT)).mode & 0o777,
          0o600,
        );
        const output = `${directory}/mapping.json`;
        assert.equal(
          run("status", { ACCOUNTS_IMPORT_OUTPUT: output }).status,
          0,
        );
        const mapping = JSON.parse(await readFile(output, "utf8"));
        assert.deepEqual(mapping.mapping.pairs, pairs);
        assert.ok(!/email|password/i.test(await readFile(output, "utf8")));
        assert.equal(
          run("apply", {
            ACCOUNTS_IMPORT_OUTPUT: `${directory}/retry.json`,
            ACCOUNTS_IMPORT_CONFIRM: "source-writers-and-target-traffic-frozen",
          }).status,
          0,
        );
        await source.query(
          'UPDATE public."User" SET "passwordHash"=$1 WHERE id=$2',
          ["a".repeat(64), fixture.users[0].id],
        );
        const drift = run("apply", {
          ACCOUNTS_IMPORT_OUTPUT: `${directory}/drift.json`,
          ACCOUNTS_IMPORT_CONFIRM: "source-writers-and-target-traffic-frozen",
        });
        assert.equal(drift.status, 1);
        assert.match(drift.stderr, /source_changed_since_snapshot/);
        await source.query(
          'UPDATE public."User" SET "passwordHash"=$1 WHERE id=$2',
          [hash, fixture.users[0].id],
        );
        await chmod(environment.ACCOUNTS_IMPORT_INPUT, 0o644);
        assert.equal(
          run("status", { ACCOUNTS_IMPORT_OUTPUT: `${directory}/unsafe.json` })
            .status,
          1,
        );
        assert.deepEqual(await counts(), {
          users: 2,
          credentials: 2,
          mappings: 2,
          batches: 1,
        });
      },
    );
    assert.deepEqual(
      (await source.query('SELECT * FROM public."User" ORDER BY id')).rows,
      sourceBefore,
    );
    assert.deepEqual((await source.query("SELECT * FROM history")).rows, [
      { id: "existing-favorite", owner: "member-1" },
    ]);
  },
);
