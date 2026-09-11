import "../scripts/check-runtime.mjs";
import pg from "pg";
import { databaseOptions } from "./database-options.mjs";
import { readConfig } from "./config.mjs";
import { createMailSender } from "./mail.mjs";
import { createAccountsProvider } from "./provider-core.mjs";
import { createAccountsServer } from "./http-server.mjs";

try {
  const config = readConfig();
  const database = new pg.Pool({
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
  const { auth } = createAccountsProvider({
    database,
    ...config,
    mail: createMailSender(config.mail, config.baseURL),
  });
  const server = createAccountsServer({ auth, database, config });
  server.listen(config.port, "0.0.0.0", () =>
    console.log("Accounts HTTP service listening"),
  );
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(async () => {
      await database.end();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
} catch {
  console.error(
    "Accounts startup refused: validate the documented environment configuration",
  );
  process.exitCode = 1;
}
