/** Read-only local configuration check. Never prints values or provisions apps. */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const products = ["AEGYO", "ARCADE", "DAEBAK"];
const productionOrigins = new Set([
  "https://aegyoarena.com",
  "https://www.aegyoarena.com",
  "https://arcade.aegyoarena.com",
  "https://daebakmarkets.com",
  "https://www.daebakmarkets.com",
]);

export function checkStagingConfiguration(env) {
  const issues = [];
  const requireValue = (name) => {
    const value = env[name];
    if (typeof value !== "string" || value.trim().length === 0) {
      issues.push(`${name}: missing`);
      return null;
    }
    return value;
  };
  const httpsOrigin = (name) => {
    const value = requireValue(name);
    if (!value) return null;
    try {
      const parsed = new URL(value);
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.search ||
        parsed.hash ||
        !["", "/"].includes(parsed.pathname) ||
        ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) ||
        productionOrigins.has(parsed.origin)
      )
        throw new Error("Invalid staging origin");
      return parsed.origin;
    } catch {
      issues.push(
        `${name}: use an isolated HTTPS staging origin, without credentials or path`,
      );
      return null;
    }
  };
  httpsOrigin("AUTH_PROOF_AUTH0_ISSUER");
  const clientIds = [];
  const origins = [];
  for (const product of products) {
    const id = requireValue(`AUTH_PROOF_${product}_CLIENT_ID`);
    requireValue(`AUTH_PROOF_${product}_CLIENT_SECRET`);
    const origin = httpsOrigin(`AUTH_PROOF_${product}_ORIGIN`);
    if (id) clientIds.push(id);
    if (origin) origins.push(origin);
  }
  if (new Set(clientIds).size !== clientIds.length) {
    issues.push("Each product needs its own provider client ID");
  }
  if (new Set(origins).size !== origins.length) {
    issues.push("Each product needs its own staging origin");
  }
  requireValue("AUTH_PROOF_DATABASE_CONNECTION_ID");
  return {
    configurationReady: issues.length === 0,
    issues,
    evidenceStillRequired: [
      "Authorized provider plan and production entitlement; no trial assumptions",
      "Privy JWT enablement and preserved existing identities/wallets/grants",
      "Aegyo production inventory, verified hashing configuration and restored staging copy",
      "SMTP delivery and approved safe migration/freeze window",
      "Real three-origin login, reset, silent renewal, linking and rollback results",
    ],
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = checkStagingConfiguration(process.env);
  console.log(JSON.stringify(result, null, 2));
  if (!result.configurationReady) process.exitCode = 2;
}
