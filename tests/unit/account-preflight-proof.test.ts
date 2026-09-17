// @vitest-environment node
import { describe, expect, it } from "vitest";
import { checkStagingConfiguration } from "../../scripts/auth-proof/preflight.mjs";

function configured() {
  const env: Record<string, string> = {
    AUTH_PROOF_AUTH0_ISSUER: "https://tenant.example.invalid",
    AUTH_PROOF_DATABASE_CONNECTION_ID: "synthetic-db-connection",
  };
  for (const app of ["AEGYO", "ARCADE", "DAEBAK"]) {
    env[`AUTH_PROOF_${app}_CLIENT_ID`] = app.toLowerCase();
    env[`AUTH_PROOF_${app}_CLIENT_SECRET`] = `secret-value-${app}`;
    env[`AUTH_PROOF_${app}_ORIGIN`] =
      `https://${app.toLowerCase()}.example.invalid`;
  }
  return env;
}

describe("staging proof preflight", () => {
  it("does not claim empty configuration is ready", () => {
    expect(checkStagingConfiguration({}).configurationReady).toBe(false);
  });
  it("keeps runtime evidence pending even with complete local configuration", () => {
    const result = checkStagingConfiguration(configured());
    expect(result.configurationReady).toBe(true);
    expect(result.evidenceStillRequired).toHaveLength(5);
    expect(JSON.stringify(result)).not.toContain("secret-value");
  });
  it.each([
    "https://arcade.aegyoarena.com",
    "http://localhost:3000",
    "https://localhost",
    "https://user:password@staging.example.invalid",
  ])("rejects unsafe or unrepresentative proof origin %s", (origin) => {
    const env = configured();
    env.AUTH_PROOF_ARCADE_ORIGIN = origin;
    expect(checkStagingConfiguration(env).configurationReady).toBe(false);
  });
  it("requires three distinct clients and origins", () => {
    const env = configured();
    env.AUTH_PROOF_ARCADE_CLIENT_ID = env.AUTH_PROOF_AEGYO_CLIENT_ID;
    env.AUTH_PROOF_ARCADE_ORIGIN = env.AUTH_PROOF_AEGYO_ORIGIN;
    expect(checkStagingConfiguration(env).configurationReady).toBe(false);
  });
});
