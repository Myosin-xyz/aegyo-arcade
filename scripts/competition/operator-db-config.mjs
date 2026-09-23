import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { checkServerIdentity } from "node:tls";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** Build a pg config for the competition CLIs without allowing unverified TLS. */
export function operatorDatabaseClientConfig(
  connectionString,
  env = process.env,
) {
  let address;
  try {
    address = new URL(connectionString);
  } catch {
    throw new Error("invalid_operator_database_url");
  }
  if (!["postgres:", "postgresql:"].includes(address.protocol))
    throw new Error("invalid_operator_database_url");

  const local = LOCAL_HOSTS.has(address.hostname);
  const sslModes = address.searchParams.getAll("sslmode");
  const caFile = env.COMPETITION_OPERATOR_DATABASE_CA_FILE?.trim();
  const tlsServerName =
    env.COMPETITION_OPERATOR_DATABASE_TLS_SERVER_NAME?.trim();

  if (caFile || tlsServerName) {
    if (local || !caFile || !tlsServerName || isIP(tlsServerName))
      throw new Error("database_pinned_tls_configuration_required");
    // pg-connection-string applies sslmode over the ssl object, so the pinned
    // CA mode must omit sslmode entirely rather than silently lose verification.
    if (sslModes.length > 0)
      throw new Error("database_pinned_tls_must_omit_sslmode");
    let ca;
    try {
      ca = readFileSync(caFile);
    } catch {
      throw new Error("database_tls_ca_unreadable");
    }
    if (ca.length === 0) throw new Error("database_tls_ca_unreadable");
    return {
      connectionString,
      ssl: {
        ca,
        rejectUnauthorized: true,
        checkServerIdentity: (_proxyHostname, certificate) =>
          checkServerIdentity(tlsServerName, certificate),
      },
    };
  }

  if (!local && (sslModes.length !== 1 || sslModes[0] !== "verify-full"))
    throw new Error("database_tls_verification_required");
  return {
    connectionString,
    ...(local ? {} : { ssl: { rejectUnauthorized: true } }),
  };
}
