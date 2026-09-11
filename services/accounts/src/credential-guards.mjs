import { readFileSync } from "node:fs";

/** Explicit migration of the disposable proof database, never a startup hook. */
export async function installCredentialGuards(database) {
  if (
    !/^\/tmp\/aegyo-idp-proof-[A-Za-z0-9]+$/.test(database.options.host ?? "")
  )
    throw new Error("Credential guard proof requires its disposable database");
  await database.query(
    readFileSync(new URL("./credential-guards.sql", import.meta.url), "utf8"),
  );
}
