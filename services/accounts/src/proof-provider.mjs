import { createAccountsProvider } from "./provider-core.mjs";
export { RESET_STATE_CLAIM } from "./provider-core.mjs";

/** Only the disposable socket may enable synthetic mail and failure injection. */
export function createProofProvider({
  database,
  secret,
  legacyPepper,
  mailbox,
  proofHooks = {},
}) {
  if (
    !/^\/tmp\/aegyo-idp-proof-[A-Za-z0-9]+$/.test(database.options.host ?? "")
  )
    throw new Error(
      "The provider proof requires its disposable local database",
    );
  return createAccountsProvider({
    database,
    secret,
    legacyPepper,
    proofHooks,
    baseURL: "https://accounts.example.test",
    signupAllowed: true,
    ipHeader: "x-aegyo-proof-ip",
    allowProofAdmin: true,
    mail: async (kind, message) => {
      if (kind === "reset") mailbox.push(message);
    },
  });
}
