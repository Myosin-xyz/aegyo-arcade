import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { admin, jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { passwordFunctions } from "./passwords.mjs";

export const RESET_STATE_CLAIM =
  "https://aegyoarena.com/claims/password-reset-state";

export const SECURITY_VERSION_CLAIM =
  "https://aegyoarena.com/claims/security-version";
export const OPERATOR_CUTOFF_CLAIM =
  "https://aegyoarena.com/claims/operator-cutoff";

/** Shared provider configuration. Runtime and isolated proofs use the same hooks. */
export function createAccountsProvider({
  database,
  secret,
  legacyPepper,
  baseURL,
  mail = null,
  signupAllowed = false,
  ipHeader = "x-aegyo-client-ip",
  proofHooks = {},
  allowProofAdmin = false,
  offlineOAuthClientCredentials = null,
}) {
  if (offlineOAuthClientCredentials && !allowProofAdmin)
    throw new Error("offline_oauth_credentials_require_offline_admin");
  const offlineClientIds = [
    ...(offlineOAuthClientCredentials?.clientIds ?? []),
  ];
  const offlineClientSecrets = [
    ...(offlineOAuthClientCredentials?.clientSecrets ?? []),
  ];
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
    appName: "Aegyo Arena",
    baseURL,
    basePath: "/api/auth",
    secret,
    database,
    trustedOrigins: [baseURL],
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
    disabledPaths: [
      "/token",
      ...blockedWriters,
      ...(allowProofAdmin
        ? []
        : [
            "/admin/ban-user",
            "/admin/unban-user",
            "/admin/revoke-user-sessions",
            "/admin/update-user",
            "/admin/set-role",
            "/admin/remove-user",
            "/admin/impersonate-user",
          ]),
    ],
    account: { accountLinking: { enabled: false } },
    session: {
      cookieCache: { enabled: false },
      expiresIn: 3600,
      additionalFields: {
        credentialVersion,
        securityVersion: credentialVersion,
      },
    },
    advanced: {
      useSecureCookies: true,
      ipAddress: { ipAddressHeaders: [ipHeader] },
    },
    rateLimit: { enabled: true, storage: "database" },
    user: {
      additionalFields: {
        passwordChangedAt: { type: "date", required: false, input: false },
        credentialVersion,
        securityVersion: credentialVersion,
        operatorRevokedAt: {
          type: "date",
          required: false,
          input: false,
          returned: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      disableSignUp: !signupAllowed,
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
      sendResetPassword: async (message) => {
        if (!mail)
          throw new APIError("SERVICE_UNAVAILABLE", {
            code: "EMAIL_UNAVAILABLE",
            message: "Email is temporarily unavailable.",
          });
        await mail("reset", message);
      },
      onPasswordReset: async ({ user }) => {
        // Security state commits in the credential trigger before this hook.
        // Test-only failure injection; no secrets or passwords enter callbacks.
        await proofHooks.afterCredentialCommit?.({ userId: user.id });
      },
    },
    emailVerification: {
      sendOnSignUp: Boolean(mail),
      autoSignInAfterVerification: false,
      sendVerificationEmail: async (message) => {
        if (!mail)
          throw new APIError("SERVICE_UNAVAILABLE", {
            code: "EMAIL_UNAVAILABLE",
            message: "Email is temporarily unavailable.",
          });
        await mail("verify", message);
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (blockedWriters.includes(ctx.path)) denyUnsupportedWriter();
        if (!allowProofAdmin && ctx.path.startsWith("/admin/"))
          throw new APIError("FORBIDDEN", {
            code: "OFFLINE_ADMIN_ONLY",
            message: "Use the operator procedure.",
          });
        if (
          !mail &&
          ["/request-password-reset", "/send-verification-email"].includes(
            ctx.path,
          )
        )
          throw new APIError("SERVICE_UNAVAILABLE", {
            code: "EMAIL_UNAVAILABLE",
            message: "Email is temporarily unavailable.",
          });
        if (ctx.path !== "/sign-in/email") return;
        const email =
          typeof ctx.body?.email === "string"
            ? ctx.body.email.toLowerCase()
            : "";
        const user = (
          await database.query(
            'SELECT id, "credentialVersion", "securityVersion" FROM "user" WHERE email=$1',
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
              Object.hasOwn(user, "passwordChangedAt") ||
              Object.hasOwn(user, "securityVersion") ||
              Object.hasOwn(user, "operatorRevokedAt")
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
              return {
                data: { ...session, credentialVersion: 0, securityVersion: 0 },
              };
            const snapshot = ctx?.context.aegyoCredentialSnapshot;
            if (
              ctx?.path !== "/sign-in/email" ||
              snapshot?.id !== session.userId ||
              !Number.isSafeInteger(snapshot.credentialVersion) ||
              !Number.isSafeInteger(snapshot.securityVersion)
            )
              return false;
            await proofHooks.beforeSessionInsert?.({ userId: session.userId });
            return {
              data: {
                ...session,
                credentialVersion: snapshot.credentialVersion,
                securityVersion: snapshot.securityVersion,
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
        ...(offlineOAuthClientCredentials
          ? {
              clientReference: () => "aegyo-first-party-v1",
              generateClientId: () => {
                const value = offlineClientIds.shift();
                if (!value) throw new Error("offline_client_id_exhausted");
                return value;
              },
              generateClientSecret: () => {
                const value = offlineClientSecrets.shift();
                if (!value) throw new Error("offline_client_secret_exhausted");
                return value;
              },
            }
          : {}),
        customIdTokenClaims: ({ user, scopes }) => {
          const granted = new Set(scopes);
          const claims = {
            [SECURITY_VERSION_CLAIM]: user.securityVersion,
            [OPERATOR_CUTOFF_CLAIM]: user.operatorRevokedAt
              ? new Date(user.operatorRevokedAt).toISOString()
              : null,
            [RESET_STATE_CLAIM]: {
              version: 1,
              kind: "database",
              lastPasswordReset: user.passwordChangedAt
                ? new Date(user.passwordChangedAt).toISOString()
                : null,
            },
          };
          if (granted.has("email")) {
            claims.email = user.email;
            claims.email_verified = user.emailVerified === true;
          }
          if (granted.has("profile")) {
            if (typeof user.name === "string") claims.name = user.name;
            if (typeof user.image === "string") claims.picture = user.image;
          }
          return claims;
        },
      }),
    ],
  };
  return { auth: betterAuth(options), options };
}
