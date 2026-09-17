export const NORMAL_MAX_AGE_SECONDS = 3_600;
export const PROVIDER_STATE_MAX_AGE_MS = 30_000;
export const MEMBER_SESSION_TTL_SECONDS = 60 * 60 * 8;

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
