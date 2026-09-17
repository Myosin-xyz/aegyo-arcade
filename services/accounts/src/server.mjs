import "../scripts/check-runtime.mjs";
import { readConfig } from "./config.mjs";
import { createAccountsRuntime } from "./runtime.mjs";

try {
  const config = readConfig();
  const { database, server } = createAccountsRuntime(config);
  server.listen(config.port, "0.0.0.0", () =>
    console.log("Accounts HTTP service listening"),
  );
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    server.close(async () => {
      await database?.end();
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
