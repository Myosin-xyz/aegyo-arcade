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
  if (env.ACCOUNTS_MAIL_FIXTURE_EMAIL !== "mateo@myosin.xyz")
    refuse("mail_fixture_recipient_mismatch");
  if (env.ACCOUNTS_MIGRATION_DATABASE_NAME !== "accounts_staging")
    refuse("mail_fixture_database_mismatch");
  return {
    baseURL: env.ACCOUNTS_BASE_URL,
    email: env.ACCOUNTS_MAIL_FIXTURE_EMAIL,
  };
}
