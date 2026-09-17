// @vitest-environment node
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { evaluateFreshness, RESET_STATE_CLAIM } from "@/accounts/freshness";

const { onExecutePostLogin } = createRequire(import.meta.url)(
  "../../auth0/actions/password-reset-state.cjs",
);
const secrets = {
  AEGYO_CLIENT_ID: "site",
  ARCADE_CLIENT_ID: "arcade",
  DAEBAK_CLIENT_ID: "markets",
};

async function run(overrides = {}) {
  const api = {
    access: { deny: vi.fn() },
    idToken: { setCustomClaim: vi.fn() },
  };
  await onExecutePostLogin(
    {
      secrets,
      client: { client_id: "arcade" },
      connection: { strategy: "auth0" },
      user: {},
      ...overrides,
    },
    api,
  );
  return api;
}

describe("staging post-login Action contract", () => {
  it("emits an explicit no-reset state at account creation", async () => {
    const api = await run();
    expect(api.access.deny).not.toHaveBeenCalled();
    expect(api.idToken.setCustomClaim).toHaveBeenCalledWith(RESET_STATE_CLAIM, {
      version: 1,
      kind: "database",
      lastPasswordReset: null,
    });
  });

  it.each(Object.values(secrets))(
    "provides the adapter's stale-SSO check for %s",
    async (id) => {
      const api = await run({
        client: { client_id: id },
        user: { last_password_reset: "2026-09-11T12:00:00.450Z" },
      });
      const claim = api.idToken.setCustomClaim.mock.calls[0][1];
      expect(
        evaluateFreshness({
          authTime: Date.parse("2026-09-11T11:59:59Z") / 1000,
          resetState: claim,
          operatorCutoffMs: null,
          transaction: {
            requestedAtMs: Date.parse("2026-09-11T12:00:01Z"),
            maxAgeSeconds: 300,
            reauthenticationAttempt: 0,
          },
          nowMs: Date.parse("2026-09-11T12:00:02Z"),
        }).kind,
      ).toBe("reauthenticate");
    },
  );

  it("fails closed on unknown clients and incomplete configuration", async () => {
    for (const override of [
      { secrets: {} },
      { client: { client_id: "unconfigured" } },
    ]) {
      const api = await run(override);
      expect(api.access.deny).toHaveBeenCalledOnce();
      expect(api.idToken.setCustomClaim).not.toHaveBeenCalled();
    }
  });

  it("does not call a social connection a database account without resets", async () => {
    const api = await run({ connection: { strategy: "google-oauth2" } });
    expect(api.idToken.setCustomClaim).toHaveBeenCalledWith(RESET_STATE_CLAIM, {
      version: 1,
      kind: "unsupported",
    });
  });

  it("rejects corrupt reset state instead of emitting no reset", async () => {
    const api = await run({ user: { last_password_reset: "not-a-date" } });
    expect(api.access.deny).toHaveBeenCalledOnce();
    expect(api.idToken.setCustomClaim).not.toHaveBeenCalled();
  });

  it("does not treat missing provider user data as an account without resets", async () => {
    const api = await run({ user: undefined });
    expect(api.access.deny).toHaveBeenCalledOnce();
    expect(api.idToken.setCustomClaim).not.toHaveBeenCalled();
  });
});
