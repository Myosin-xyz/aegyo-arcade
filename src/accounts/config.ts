export const NORMAL_MAX_AGE_SECONDS = 3_600;
export const PROVIDER_STATE_MAX_AGE_MS = 30_000;
/** Local member session lifetime for a website sign-in (ADR 0009). */
export const WEB_SESSION_TTL_SECONDS = 24 * 60 * 60;
/** Local member session lifetime when the login entry said `client=mobile`. */
export const MOBILE_SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;

/**
 * Which client started the sign-in. A convenience signal, not a security
 * boundary: anyone can add `client=mobile` and gets a long session on their own
 * account. Revocation never depends on it (session-state recheck every 30 s).
 */
export type AccountClient = "web" | "mobile";

/** Exactly `"mobile"` means mobile; anything else, including absence, is web. */
export function parseAccountClient(value: unknown): AccountClient {
  return value === "mobile" ? "mobile" : "web";
}

export function memberSessionTtlSeconds(client: AccountClient): number {
  return client === "mobile"
    ? MOBILE_SESSION_TTL_SECONDS
    : WEB_SESSION_TTL_SECONDS;
}

export type AccountsConfig = {
  providerBaseUrl: string;
  issuer: string;
  clientId: string;
  clientSecret: string;
  appOrigin: string;
  transactionSecret: string;
  stateReaderKey: string;
};

type Environment = Readonly<Record<string, string | undefined>>;

export function accountsEnabled(env: Environment = process.env): boolean {
  return env.ARCADE_SHARED_AUTH_ENABLED === "true";
}

export function getAccountsConfig(
  env: Environment = process.env,
): AccountsConfig | null {
  if (!accountsEnabled(env)) return null;
  const baseUrl = parseAbsoluteOrigin(env.ARCADE_AUTH_BASE_URL);
  const appOrigin = parseAbsoluteOrigin(env.ARCADE_APP_ORIGIN);
  const clientId = env.ARCADE_AUTH_CLIENT_ID;
  const clientSecret = env.ARCADE_AUTH_CLIENT_SECRET;
  const transactionSecret = env.ARCADE_AUTH_TRANSACTION_SECRET;
  const stateReaderKey = env.ARCADE_AUTH_STATE_READER_KEY;
  if (
    !baseUrl ||
    !appOrigin ||
    !clientId ||
    !clientSecret ||
    !transactionSecret ||
    transactionSecret.length < 32 ||
    !stateReaderKey
  ) {
    return null;
  }
  return {
    providerBaseUrl: baseUrl,
    issuer: `${baseUrl}/api/auth`,
    clientId,
    clientSecret,
    appOrigin,
    transactionSecret,
    stateReaderKey,
  };
}

function parseAbsoluteOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return null;
    if (
      url.protocol !== "https:" &&
      !(url.protocol === "http:" && url.hostname === "localhost")
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
