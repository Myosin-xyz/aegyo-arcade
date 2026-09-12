#!/usr/bin/env node
import "./check-runtime.mjs";
import { randomBytes } from "node:crypto";
import { mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { CompiledQuery, Kysely, PostgresDialect } from "kysely";
import { createAccountsProvider } from "../src/provider-core.mjs";
import { databaseOptions } from "../src/database-options.mjs";
import {
  MailFixtureRefusal,
  validateMailFixtureConfig,
} from "./seed-mail-staging-fixture-lib.mjs";
const required = (name) =>
  process.env[name] ||
  (() => {
    throw new MailFixtureRefusal(`missing_${name}`);
  })();
const { baseURL, email } = validateMailFixtureConfig(process.env);
const root = fileURLToPath(new URL("../.proof", import.meta.url));
const output = resolve(required("ACCOUNTS_MAIL_FIXTURE_OUTPUT"));
await mkdir(root, { recursive: true, mode: 0o700 });
const parent = await realpath(dirname(output));
if (relative(await realpath(root), parent).startsWith(".."))
  throw new MailFixtureRefusal("fixture_output_outside_private_proof");
const connectionString = required("ACCOUNTS_MIGRATION_DATABASE_URL");
const localProof =
  process.env.ACCOUNTS_MAIL_FIXTURE_LOCAL_PROOF === "disposable-unix-socket";
if (localProof) {
  const url = new URL(connectionString);
  if (
    url.hostname !== "localhost" ||
    !/^\/tmp\/aegyo-idp-proof-[A-Za-z0-9]+$/.test(
      url.searchParams.get("host") ?? "",
    )
  )
    throw new MailFixtureRefusal("local_proof_must_use_disposable_unix_socket");
}
const pool = new pg.Pool({
  ...databaseOptions(
    connectionString,
    localProof
      ? {}
      : {
          caCertificate: required("ACCOUNTS_MIGRATION_DATABASE_CA_CERT"),
          serverSHA256: required("ACCOUNTS_MIGRATION_DATABASE_SERVER_SHA256"),
        },
  ),
  max: 1,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,
  lock_timeout: 5000,
  application_name: "accounts-mail-staging-fixture",
});
let createdOutput = false;
let committed = false;
const kysely = new Kysely({ dialect: new PostgresDialect({ pool }) });
try {
  await kysely.transaction().execute(async (transaction) => {
    const database = {
      async query(text, parameters = []) {
        const result = await transaction.executeQuery(
          CompiledQuery.raw(text, parameters),
        );
        return {
          rows: result.rows,
          rowCount: Number(result.numAffectedRows ?? result.rows.length),
        };
      },
    };
    const adapterDatabase = {
      db: transaction,
      type: "postgres",
      transaction: false,
    };
    await database.query(
      "SELECT pg_advisory_xact_lock(hashtext('accounts-mail-staging-fixture-v1'))",
    );
    const identity = (
      await database.query("SELECT current_database() database")
    ).rows[0];
    if (identity.database !== "accounts_staging")
      throw new MailFixtureRefusal("mail_fixture_database_mismatch");
    if (
      (
        await database.query(
          'SELECT count(*)::int count FROM "user" WHERE lower(email)=lower($1)',
          [email],
        )
      ).rows[0].count !== 0
    )
      throw new MailFixtureRefusal("mail_fixture_identity_already_exists");
    const delivered = [];
    const { auth } = createAccountsProvider({
      database,
      offlineAdapterDatabase: adapterDatabase,
      allowProofAdmin: true,
      secret: required("BETTER_AUTH_SECRET"),
      legacyPepper: required("ACCOUNTS_LEGACY_PEPPER"),
      baseURL,
      signupAllowed: true,
      mail: async (kind, message) =>
        delivered.push({ kind, recipient: message.user.email }),
    });
    const password = randomBytes(36).toString("base64url");
    const response = await auth.handler(
      new Request(`${baseURL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseURL,
          "x-aegyo-client-ip": "192.0.2.44",
        },
        body: JSON.stringify({
          name: "Staging mail delivery fixture",
          email,
          password,
        }),
      }),
    );
    if (!response.ok) throw new MailFixtureRefusal("official_signup_failed");
    const body = await response.json();
    if (
      delivered.length !== 1 ||
      delivered[0].kind !== "verify" ||
      delivered[0].recipient !== email
    )
      throw new MailFixtureRefusal("fixture_mail_recorder_mismatch");
    await database.query('DELETE FROM "session" WHERE "userId"=$1', [
      body.user.id,
    ]);
    const file = await open(output, "wx", 0o600);
    createdOutput = true;
    try {
      await file.writeFile(
        JSON.stringify({
          version: 1,
          environment: "staging",
          baseURL,
          userId: body.user.id,
          email,
          password,
        }) + "\n",
      );
      await file.sync();
    } finally {
      await file.close();
    }
  });
  committed = true;
  console.info(
    JSON.stringify({
      created: true,
      emailVerified: false,
      sessions: 0,
      output,
    }),
  );
} catch (error) {
  if (createdOutput && !committed) await unlink(output).catch(() => {});
  console.error(
    error instanceof MailFixtureRefusal ? error.message : "mail_fixture_failed",
  );
  process.exitCode = 1;
} finally {
  await kysely.destroy();
}
