import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
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
  proofHooks = {},
}) {
  if (
    !/^\/tmp\/aegyo-idp-proof-[A-Za-z0-9]+$/.test(database.options.host ?? "")
  ) {
    throw new Error(
      "The provider proof requires its disposable local database",
    );
  }
  const passwords = passwordFunctions(legacyPepper);
  const blockedWriters = [
    "/change-password",
    "/set-password",
    "/admin/set-user-password",
    "/admin/create-user",
  ];
  const credentialVersion = {
    type: "number",
    required: true,
    defaultValue: 0,
    input: false,
    returned: false,
  };
  function denyUnsupportedWriter() {
    throw new APIError("FORBIDDEN", {
      code: "USE_PASSWORD_RECOVERY",
      message: "Use email password recovery.",
    });
  }
  const options = {
    appName: "Aegyo Accounts Proof",
    baseURL: "https://accounts.example.test",
    basePath: "/api/auth",
    secret,
    database,
    trustedOrigins: ["https://accounts.example.test"],
    logger: { disabled: true },
    onAPIError: {
      onError(error) {
        if (error instanceof APIError) throw error;
        if (
          error?.code === "40001" &&
          error.message === "stale_credential_session"
        )
          throw new APIError("UNAUTHORIZED", {
            code: "CREDENTIAL_CHANGED",
            message: "Your credentials changed. Please sign in again.",
          });
        // The proof deliberately injects failures. Neither SQL nor stack traces
        // belong in its HTTP response or unsanitized provider logs.
        throw new APIError("INTERNAL_SERVER_ERROR", {
          code: "AUTH_OPERATION_FAILED",
          message: "Please retry sign-in or request a new recovery link.",
        });
      },
    },
    disabledPaths: ["/token", ...blockedWriters],
    account: { accountLinking: { enabled: false } },
    session: {
      cookieCache: { enabled: false },
      expiresIn: 3600,
      additionalFields: { credentialVersion },
    },
    advanced: {
      useSecureCookies: true,
      ipAddress: { ipAddressHeaders: ["x-aegyo-proof-ip"] },
    },
    rateLimit: { enabled: true, storage: "database" },
    user: {
      additionalFields: {
        passwordChangedAt: { type: "date", required: false, input: false },
        credentialVersion,
      },
    },
    emailAndPassword: {
      enabled: true,
      // Verification is required at contest enrollment; importing a password
      // must not silently change a legacy email's verification state.
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      password: {
        ...passwords,
        verify: async (input) => {
          const valid = await passwords.verify(input);
          await proofHooks.afterPasswordVerification?.({ valid });
          return valid;
        },
      },
      sendResetPassword: async (message) => mailbox.push(message),
      onPasswordReset: async ({ user }) => {
        // Security state commits in the credential trigger before this hook.
        // Test-only failure injection; no secrets or passwords enter callbacks.
        await proofHooks.afterCredentialCommit?.({ userId: user.id });
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (blockedWriters.includes(ctx.path)) denyUnsupportedWriter();
        if (ctx.path !== "/sign-in/email") return;
        const email =
          typeof ctx.body?.email === "string"
            ? ctx.body.email.toLowerCase()
            : "";
        const user = (
          await database.query(
            'SELECT id, "credentialVersion" FROM "user" WHERE email=$1',
            [email],
          )
        ).rows[0];
        // Capture before password verification, never refresh this snapshot at
        // session issuance. The value is private to this endpoint invocation.
        ctx.context.aegyoCredentialSnapshot = user;
      }),
    },
    databaseHooks: {
      user: {
        update: {
          before: async (user) => {
            if (
              Object.hasOwn(user, "credentialVersion") ||
              Object.hasOwn(user, "passwordChangedAt")
            )
              throw new APIError("FORBIDDEN", {
                code: "SECURITY_STATE_MANAGED",
                message:
                  "Credential security state is managed by the database.",
              });
          },
        },
      },
      account: {
        create: {
          before: async (account, ctx) => {
            if (
              account.providerId === "credential" &&
              ctx?.path !== "/sign-up/email"
            )
              denyUnsupportedWriter();
          },
        },
        update: {
          before: async (account, ctx) => {
            if (
              account.password !== undefined &&
              ctx?.path !== "/reset-password"
            )
              denyUnsupportedWriter();
          },
        },
      },
      session: {
        create: {
          before: async (session, ctx) => {
            if (ctx?.path === "/sign-up/email")
              return { data: { ...session, credentialVersion: 0 } };
            const snapshot = ctx?.context.aegyoCredentialSnapshot;
            if (
              ctx?.path !== "/sign-in/email" ||
              snapshot?.id !== session.userId ||
              !Number.isSafeInteger(snapshot.credentialVersion)
            )
              return false;
            await proofHooks.beforeSessionInsert?.({ userId: session.userId });
            return {
              data: {
                ...session,
                credentialVersion: snapshot.credentialVersion,
              },
            };
          },
        },
      },
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
