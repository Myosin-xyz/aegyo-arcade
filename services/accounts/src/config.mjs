import { isIP } from "node:net";

export function readConfig(env = process.env) {
  const required = (name, minimum = 1) => {
    const value = env[name];
    if (typeof value !== "string" || value.length < minimum)
      throw new Error(`Missing or invalid ${name}`);
    return value;
  };
  const environment = required("ACCOUNTS_ENVIRONMENT");
  if (!["staging", "production"].includes(environment))
    throw new Error("Invalid ACCOUNTS_ENVIRONMENT");
  const base = new URL(required("ACCOUNTS_BASE_URL"));
  if (
    base.protocol !== "https:" ||
    base.pathname !== "/" ||
    base.search ||
    base.hash ||
    base.username ||
    base.password
  )
    throw new Error("ACCOUNTS_BASE_URL must be a bare HTTPS origin");
  const databaseURL = required("DATABASE_URL");
  if (!["postgres:", "postgresql:"].includes(new URL(databaseURL).protocol))
    throw new Error("Invalid DATABASE_URL protocol");
  const readers = JSON.parse(required("ACCOUNTS_STATE_READERS_JSON"));
  if (
    !readers ||
    Array.isArray(readers) ||
    typeof readers !== "object" ||
    !Object.keys(readers).length ||
    Object.entries(readers).some(
      ([name, key]) =>
        !/^[a-z][a-z0-9-]{0,40}$/.test(name) ||
        typeof key !== "string" ||
        key.length < 32,
    ) ||
    new Set(Object.values(readers)).size !== Object.values(readers).length
  )
    throw new Error("Invalid per-product state reader keys");
  const ipMode = env.ACCOUNTS_CLIENT_IP_MODE || "socket";
  if (!["socket", "railway-x-real-ip"].includes(ipMode))
    throw new Error("Invalid ACCOUNTS_CLIENT_IP_MODE");
  if (
    ipMode === "railway-x-real-ip" &&
    env.ACCOUNTS_RAILWAY_IP_VERIFIED !== "true"
  )
    throw new Error(
      "Railway proxy IP behavior must be verified before trusting its header",
    );
  const mailMode = env.ACCOUNTS_MAIL_MODE || "disabled";
  if (!["disabled", "mailjet"].includes(mailMode))
    throw new Error("Invalid ACCOUNTS_MAIL_MODE");
  const mail =
    mailMode === "mailjet"
      ? {
          apiKey: required("MAILJET_API_KEY"),
          secretKey: required("MAILJET_SECRET_KEY"),
          from: required("MAILJET_FROM_EMAIL"),
        }
      : null;
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail.from))
    throw new Error("Invalid MAILJET_FROM_EMAIL");
  const signupAllowed = env.ACCOUNTS_SIGNUP_ENABLED === "true";
  if (signupAllowed && !mail)
    throw new Error("Signup requires configured email delivery");
  if (environment === "production" && (!mail || ipMode !== "railway-x-real-ip"))
    throw new Error(
      "Production requires email and verified Railway client IP handling",
    );
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  return Object.freeze({
    environment,
    baseURL: base.origin,
    databaseURL,
    secret: required("BETTER_AUTH_SECRET", 32),
    legacyPepper: required("ACCOUNTS_LEGACY_PEPPER"),
    readers,
    ipMode,
    mail,
    signupAllowed,
    port,
  });
}

/** The synthetic internal header is always overwritten, never accepted from clients. */
export function clientIP(request, mode) {
  const candidate =
    mode === "railway-x-real-ip"
      ? request.headers["x-real-ip"]
      : request.socket.remoteAddress;
  return typeof candidate === "string" && isIP(candidate)
    ? candidate
    : "unknown";
}
