import "./check-runtime.mjs";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { databaseOptions } from "../src/database-options.mjs";
import { createAccountsProvider } from "../src/provider-core.mjs";

class SeedRefusal extends Error {}
process.on("uncaughtException", (error) => {
  console.error(
    error instanceof SeedRefusal
      ? error.message
      : "Accounts staging seed refused before database access; validate the documented environment.",
  );
  process.exitCode = 1;
});
const refuse = (message) => {
  throw new SeedRefusal(message);
};
const required = (name, minimum = 1) => {
  const value = process.env[name];
  if (typeof value !== "string" || value.length < minimum)
    refuse(`Missing or invalid ${name}`);
  return value;
};
const parseHttps = (value, name, { originOnly = false } = {}) => {
  let url;
  try {
    url = new URL(value);
  } catch {
    refuse(`${name} must be a valid URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (originOnly && (url.pathname !== "/" || url.search))
  )
    refuse(
      `${name} must be ${originOnly ? "a bare HTTPS origin" : "an HTTPS URL without credentials or fragment"}`,
    );
  return url;
};

if (process.env.ACCOUNTS_ENVIRONMENT !== "staging")
  refuse("ACCOUNTS_ENVIRONMENT must be staging");
if (process.env.ACCOUNTS_STAGING_SEED_CONFIRM !== "synthetic-only")
  refuse("ACCOUNTS_STAGING_SEED_CONFIRM must be synthetic-only");
if (process.env.DATABASE_URL)
  refuse("DATABASE_URL must not be present in the staging seed process");

const connectionString = required("ACCOUNTS_MIGRATION_DATABASE_URL");
let databaseUrl;
try {
  databaseUrl = new URL(connectionString);
} catch {
  refuse("ACCOUNTS_MIGRATION_DATABASE_URL must be a PostgreSQL URL");
}
if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol))
  refuse("ACCOUNTS_MIGRATION_DATABASE_URL must be a PostgreSQL URL");
const baseURL = parseHttps(required("ACCOUNTS_BASE_URL"), "ACCOUNTS_BASE_URL", {
  originOnly: true,
}).origin;
const secret = required("BETTER_AUTH_SECRET", 32);
const legacyPepper = required("ACCOUNTS_LEGACY_PEPPER");

let clients;
try {
  clients = JSON.parse(required("ACCOUNTS_STAGING_CLIENTS_JSON"));
} catch {
  refuse("ACCOUNTS_STAGING_CLIENTS_JSON must be valid JSON");
}
if (!Array.isArray(clients) || clients.length !== 3)
  refuse("ACCOUNTS_STAGING_CLIENTS_JSON must contain exactly three clients");
const names = new Set();
const origins = new Set();
clients = clients.map((client, index) => {
  if (!client || typeof client !== "object" || Array.isArray(client))
    refuse(`Staging client ${index + 1} must be an object`);
  const keys = Object.keys(client).sort();
  if (keys.join(",") !== "name,postLogoutRedirectUri,redirectUri")
    refuse(`Staging client ${index + 1} has unexpected or missing fields`);
  if (
    typeof client.name !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(client.name)
  )
    refuse(`Staging client ${index + 1} has an invalid name`);
  const redirect = parseHttps(
    client.redirectUri,
    `Staging client ${index + 1} redirectUri`,
  );
  const postLogout = parseHttps(
    client.postLogoutRedirectUri,
    `Staging client ${index + 1} postLogoutRedirectUri`,
  );
  if (redirect.origin !== postLogout.origin)
    refuse(`Staging client ${index + 1} redirect origins must match`);
  if (names.has(client.name) || origins.has(redirect.origin))
    refuse("Staging client names and origins must be distinct");
  names.add(client.name);
  origins.add(redirect.origin);
  return {
    name: client.name,
    redirectUri: redirect.href,
    postLogoutRedirectUri: postLogout.href,
  };
});

const serviceRoot = fileURLToPath(new URL("..", import.meta.url));
const proofRoot = resolve(serviceRoot, ".proof");
const outputPath = resolve(required("ACCOUNTS_STAGING_OUTPUT_PATH"));
const outputRelative = relative(proofRoot, outputPath);
if (
  !outputRelative ||
  outputRelative.startsWith("..") ||
  outputRelative.includes("..") ||
  outputRelative.startsWith("/")
)
  refuse(
    "ACCOUNTS_STAGING_OUTPUT_PATH must be a file within services/accounts/.proof",
  );

const database = new pg.Pool({
  ...databaseOptions(connectionString, {
    caCertificate:
      process.env.ACCOUNTS_MIGRATION_DATABASE_CA_CERT ??
      process.env.ACCOUNTS_DATABASE_CA_CERT,
    serverSHA256:
      process.env.ACCOUNTS_MIGRATION_DATABASE_SERVER_SHA256 ??
      process.env.ACCOUNTS_DATABASE_SERVER_SHA256,
  }),
  max: 1,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
  lock_timeout: 5_000,
  application_name: "aegyo-accounts-staging-seed",
});
let outputCreated = false;
let committed = false;
let phase = "connect";
try {
  phase = "lock";
  await database.query("BEGIN");
  await database.query("SET LOCAL lock_timeout = '5s'");
  await database.query("SET LOCAL statement_timeout = '30s'");
  await database.query(
    "SELECT pg_advisory_xact_lock(hashtext('aegyo-accounts-staging-seed-v1'))",
  );
  const inventory = await database.query(
    `SELECT to_regclass('public.aegyo_schema_version') AS marker,
            to_regclass('public.user') AS users`,
  );
  if (!inventory.rows[0]?.marker || !inventory.rows[0]?.users)
    refuse("Refusing seed: the dedicated Accounts schema is not migrated");
  const count = await database.query(
    'SELECT count(*)::integer AS count FROM public."user"',
  );
  if (count.rows[0]?.count !== 0)
    refuse("Refusing seed: the Accounts user table is not empty");

  const mailEvents = [];
  const { auth } = createAccountsProvider({
    database,
    secret,
    legacyPepper,
    baseURL,
    signupAllowed: true,
    allowProofAdmin: true,
    mail: async (kind) => mailEvents.push(kind),
  });
  const signup = async ({ name, email, password }) => {
    const response = await auth.handler(
      new Request(`${baseURL}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseURL,
          "x-aegyo-client-ip": "192.0.2.1",
        },
        body: JSON.stringify({ name, email, password }),
      }),
    );
    if (!response.ok) refuse("Official synthetic signup failed");
    const result = await response.json();
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";", 1)[0])
      .join("; ");
    if (!result?.user?.id || !cookie)
      refuse("Official synthetic signup returned an incomplete result");
    return { id: result.user.id, cookie };
  };

  phase = "bootstrap-operator";
  const operatorPassword = randomBytes(32).toString("base64url");
  const operator = await signup({
    name: "Synthetic staging operator",
    email: "fake@example.invalid",
    password: operatorPassword,
  });
  await database.query('UPDATE public."user" SET role=$1 WHERE id=$2', [
    "admin",
    operator.id,
  ]);

  phase = "register-clients";
  const registeredClients = [];
  for (const client of clients) {
    const registered = await auth.api.adminCreateOAuthClient({
      headers: new Headers({ cookie: operator.cookie }),
      body: {
        client_name: client.name,
        redirect_uris: [client.redirectUri],
        post_logout_redirect_uris: [client.postLogoutRedirectUri],
        scope: "openid email profile",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "client_secret_basic",
        skip_consent: true,
        require_pkce: true,
        enable_end_session: true,
      },
    });
    if (!registered?.client_id || !registered?.client_secret)
      refuse(
        "Official OAuth client registration returned an incomplete result",
      );
    registeredClients.push({
      name: client.name,
      clientId: registered.client_id,
      clientSecret: registered.client_secret,
      redirectUri: client.redirectUri,
      postLogoutRedirectUri: client.postLogoutRedirectUri,
    });
  }

  phase = "synthetic-member";
  const memberPassword = randomBytes(32).toString("base64url");
  const memberEmail = `synthetic-${randomBytes(12).toString("hex")}@example.invalid`;
  const member = await signup({
    name: "Synthetic staging member",
    email: memberEmail,
    password: memberPassword,
  });
  const memberState = await database.query(
    'SELECT "emailVerified" FROM public."user" WHERE id=$1',
    [member.id],
  );
  if (memberState.rows[0]?.emailVerified !== false)
    refuse("Synthetic member must begin with an unverified email");

  phase = "disable-bootstrap";
  await database.query(
    'DELETE FROM public."session" WHERE "userId" IN ($1,$2)',
    [operator.id, member.id],
  );
  await database.query(
    `UPDATE public."user"
       SET banned=true, role='user', "operatorRevokedAt"=clock_timestamp(),
           "banReason"='offline staging bootstrap complete'
     WHERE id=$1`,
    [operator.id],
  );

  phase = "write-output";
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 });
  const canonicalProof = await realpath(proofRoot);
  const canonicalDirectory = await realpath(dirname(outputPath));
  const canonicalRelative = relative(canonicalProof, canonicalDirectory);
  if (canonicalRelative.startsWith("..") || canonicalRelative.startsWith("/"))
    refuse(
      "ACCOUNTS_STAGING_OUTPUT_PATH resolves outside services/accounts/.proof",
    );
  await chmod(dirname(outputPath), 0o700);
  const handle = await open(outputPath, "wx", 0o600);
  outputCreated = true;
  try {
    await handle.writeFile(
      `${JSON.stringify(
        {
          environment: "staging",
          baseURL,
          member: { email: memberEmail, password: memberPassword },
          clients: registeredClients,
        },
        null,
        2,
      )}\n`,
      { encoding: "utf8" },
    );
  } finally {
    await handle.close();
  }
  await chmod(outputPath, 0o600);
  if (mailEvents.length !== 2 || mailEvents.some((kind) => kind !== "verify"))
    refuse(
      "Synthetic signup did not use the expected no-network mail recorder",
    );

  phase = "commit";
  await database.query("COMMIT");
  committed = true;
  console.info(
    `Seeded 1 synthetic member and ${registeredClients.length} OAuth clients; credentials written to ${outputPath}`,
  );
} catch (error) {
  if (!committed) await database.query("ROLLBACK").catch(() => {});
  if (outputCreated && !committed) await unlink(outputPath).catch(() => {});
  console.error(
    error instanceof SeedRefusal
      ? error.message
      : `Accounts staging seed failed (${phase}); inspect sanitized database operator logs.`,
  );
  process.exitCode = 1;
} finally {
  await database.end();
}
