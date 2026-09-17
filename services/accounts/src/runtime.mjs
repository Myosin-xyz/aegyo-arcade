import pg from "pg";
import { createMailSender } from "./mail.mjs";
import { createAccountsProvider } from "./provider-core.mjs";
import { createAccountsServer } from "./http-server.mjs";
import { databaseOptions } from "./database-options.mjs";

export function createAccountsRuntime(
  config,
  {
    Pool = pg.Pool,
    mailSender = createMailSender,
    provider = createAccountsProvider,
    server = createAccountsServer,
  } = {},
) {
  if (config.trafficEnabled === false)
    return { database: null, server: server({ config }) };

  const database = new Pool({
    ...databaseOptions(config.databaseURL),
    max: 5,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
    lock_timeout: 2_000,
    application_name: "aegyo-accounts",
  });
  database.on("error", () =>
    console.error("Accounts database connection unavailable"),
  );
  const { auth } = provider({
    database,
    ...config,
    mail: mailSender(config.mail, config.baseURL),
  });
  return { database, server: server({ auth, database, config }) };
}
