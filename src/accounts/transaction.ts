import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type { AuthorizationTransaction } from "./freshness";

export type OidcTransaction = AuthorizationTransaction & {
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo: string;
};

const MAX_TRANSACTION_AGE_MS = 10 * 60 * 1000;

function key(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

export function sealTransaction(
  value: OidcTransaction,
  secret: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(secret), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function openTransaction(
  sealed: string | undefined,
  secret: string,
  nowMs = Date.now(),
): OidcTransaction | null {
  if (!sealed || sealed.length > 4096) return null;
  try {
    const bytes = Buffer.from(sealed, "base64url");
    if (bytes.length < 29) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(secret),
      bytes.subarray(0, 12),
    );
    decipher.setAuthTag(bytes.subarray(12, 28));
    const parsed: unknown = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
    if (!isTransaction(parsed)) return null;
    if (
      parsed.requestedAtMs > nowMs ||
      nowMs - parsed.requestedAtMs > MAX_TRANSACTION_AGE_MS
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function isTransaction(value: unknown): value is OidcTransaction {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.state === "string" &&
    item.state.length >= 16 &&
    typeof item.nonce === "string" &&
    item.nonce.length >= 16 &&
    typeof item.codeVerifier === "string" &&
    item.codeVerifier.length >= 43 &&
    typeof item.returnTo === "string" &&
    safeAccountReturnTo(item.returnTo) === item.returnTo &&
    Number.isSafeInteger(item.requestedAtMs) &&
    Number.isSafeInteger(item.maxAgeSeconds) &&
    (item.reauthenticationAttempt === 0 || item.reauthenticationAttempt === 1)
  );
}

const CHAMPIONSHIP_PLAY_PATH =
  /^\/play\/(snake|flappy)\?championship=[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Only routes that intentionally continue a shared-account journey. */
export function safeAccountReturnTo(value: unknown): string {
  if (value === "/account" || value === "/championship") return value;
  if (typeof value === "string" && CHAMPIONSHIP_PLAY_PATH.test(value))
    return value;
  return "/";
}
