import { timingSafeEqual } from "node:crypto";

function normalizeFingerprint(value) {
  const normalized = value?.replaceAll(":", "").toUpperCase();
  if (!/^[A-F0-9]{64}$/.test(normalized ?? ""))
    throw new Error("Database TLS server SHA-256 fingerprint is invalid");
  return normalized;
}

/**
 * Build pg connection options without weakening certificate verification.
 * Railway's public TCP proxy retains the database certificate, whose SAN is
 * private-network-only, so public operator connections pin that CA-validated
 * leaf certificate explicitly. Certificate rotation is a reviewed config update.
 */
export function databaseOptions(
  connectionString,
  {
    caCertificate = process.env.ACCOUNTS_DATABASE_CA_CERT,
    serverSHA256 = process.env.ACCOUNTS_DATABASE_SERVER_SHA256,
  } = {},
) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("Database URL protocol is invalid");
  const sslMode = url.searchParams.get("sslmode");
  const pinned = caCertificate !== undefined || serverSHA256 !== undefined;
  if (!sslMode && !pinned) return { connectionString };
  if (sslMode === "disable")
    throw new Error(
      "Database TLS cannot be disabled when trust material is configured",
    );
  if (!caCertificate || !serverSHA256)
    throw new Error(
      "Database TLS requires both a root CA and server SHA-256 fingerprint",
    );

  const expected = Buffer.from(normalizeFingerprint(serverSHA256), "hex");
  url.searchParams.delete("sslmode");
  url.searchParams.delete("sslrootcert");
  url.searchParams.delete("sslcert");
  url.searchParams.delete("sslkey");
  return {
    connectionString: url.toString(),
    ssl: {
      ca: caCertificate,
      rejectUnauthorized: true,
      checkServerIdentity(_hostname, certificate) {
        const actualValue = certificate.fingerprint256?.replaceAll(":", "");
        if (!/^[A-Fa-f0-9]{64}$/.test(actualValue ?? ""))
          return new Error(
            "Database TLS certificate fingerprint is unavailable",
          );
        const actual = Buffer.from(actualValue, "hex");
        if (!timingSafeEqual(actual, expected))
          return new Error(
            "Database TLS server identity does not match the configured pin",
          );
        return undefined;
      },
    },
  };
}
