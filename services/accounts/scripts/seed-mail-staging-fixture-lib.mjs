export class MailFixtureRefusal extends Error {}
const refuse = (code) => {
  throw new MailFixtureRefusal(code);
};
export function validateMailFixtureConfig(env) {
  if (
    env.ACCOUNTS_ENVIRONMENT !== "staging" ||
    env.ACCOUNTS_MAIL_FIXTURE_CONFIRM !== "single-owner-mailbox-fixture" ||
    env.DATABASE_URL
  )
    refuse("mail_fixture_gate_failed");
  if (
    env.ACCOUNTS_BASE_URL !==
    "https://aegyo-accounts-accounts-staging.up.railway.app"
  )
    refuse("mail_fixture_origin_mismatch");
  if (
    ![
      "mateo@myosin.xyz",
      "mateo+accounts-staging-20260915@myosin.xyz",
    ].includes(env.ACCOUNTS_MAIL_FIXTURE_EMAIL)
  )
    refuse("mail_fixture_recipient_mismatch");
  const localProof =
    env.ACCOUNTS_MAIL_FIXTURE_LOCAL_PROOF === "disposable-unix-socket";
  const databaseName = localProof ? "accounts_staging" : "railway";
  if (env.ACCOUNTS_MIGRATION_DATABASE_NAME !== databaseName)
    refuse("mail_fixture_database_mismatch");
  if (!localProof) {
    if (
      env.RAILWAY_PROJECT_ID !== "8229f87c-908d-426d-9562-4b01b0e89a50" ||
      env.RAILWAY_ENVIRONMENT_ID !== "279e0a09-8ba3-42dc-8d44-a2598d1f3fe9" ||
      env.RAILWAY_SERVICE_ID !== "38c74ef7-2b0b-4e4d-bc95-f32636274e3a"
    )
      refuse("mail_fixture_railway_identity_mismatch");
    let database;
    try {
      database = new URL(env.ACCOUNTS_MIGRATION_DATABASE_URL);
    } catch {
      refuse("mail_fixture_database_url_invalid");
    }
    if (
      database.protocol !== "postgresql:" ||
      database.hostname !== "postgres.railway.internal" ||
      database.pathname !== "/railway"
    )
      refuse("mail_fixture_private_database_binding_mismatch");
  }
  return {
    baseURL: env.ACCOUNTS_BASE_URL,
    email: env.ACCOUNTS_MAIL_FIXTURE_EMAIL,
    databaseName,
  };
}
