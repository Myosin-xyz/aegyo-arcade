import { betterAuth } from "better-auth";
import { admin, jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passwordFunctions } from "./passwords.mjs";

export const RESET_STATE_CLAIM =
  "https://aegyoarena.com/claims/password-reset-state";

/**
 * A bounded package proof, not the production IdP or an application adapter.
 * Only accepts the disposable local Postgres socket created by prove.mjs.
 * No environment files, production connection, mail service or Privy SDK.
 */
export function createProofProvider({
  database,
  secret,
  legacyPepper,
  mailbox,
}) {
  if (
    !/^\/tmp\/aegyo-idp-proof-[A-Za-z0-9]+$/.test(database.options.host ?? "")
  ) {
    throw new Error(
      "The provider proof requires its disposable local database",
    );
  }
  const options = {
    appName: "Aegyo Accounts Proof",
    baseURL: "https://accounts.example.test",
    basePath: "/api/auth",
    secret,
    database,
    trustedOrigins: ["https://accounts.example.test"],
    logger: { disabled: true },
    disabledPaths: ["/token"],
    account: { accountLinking: { enabled: false } },
    session: { cookieCache: { enabled: false }, expiresIn: 3600 },
    advanced: {
      useSecureCookies: true,
      ipAddress: { ipAddressHeaders: ["x-aegyo-proof-ip"] },
    },
    rateLimit: { enabled: true, storage: "database" },
    user: {
      additionalFields: {
        passwordChangedAt: { type: "date", required: false, input: false },
      },
    },
    emailAndPassword: {
      enabled: true,
      // Verification is required at contest enrollment; importing a password
      // must not silently change a legacy email's verification state.
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      password: passwordFunctions(legacyPepper),
      sendResetPassword: async (message) => mailbox.push(message),
    },
    plugins: [
      admin(),
      jwt(),
      oauthProvider({
        loginPage: "/sign-in",
        consentPage: "/consent",
        scopes: ["openid", "email", "profile"],
        grantTypes: ["authorization_code"],
        allowDynamicClientRegistration: false,
        allowUnauthenticatedClientRegistration: false,
        clientPrivileges: async ({ user }) => user?.role === "admin",
        customIdTokenClaims: ({ user }) => ({
          [RESET_STATE_CLAIM]: {
            version: 1,
            kind: "database",
            lastPasswordReset: user.passwordChangedAt
              ? new Date(user.passwordChangedAt).toISOString()
              : null,
          },
        }),
      }),
    ],
  };
  return { auth: betterAuth(options), options };
}
