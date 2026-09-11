// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  evaluateFreshness,
  parseResetInstant,
  type AuthorizationTransaction,
} from "@/accounts/freshness";

const base = Date.parse("2026-09-11T12:00:00.000Z");
const resetMs = base + 450;
const state = {
  version: 1,
  kind: "database",
  lastPasswordReset: new Date(resetMs).toISOString(),
};
const normal: AuthorizationTransaction = {
  requestedAtMs: base + 600,
  maxAgeSeconds: 300, // Synthetic policy, not the production lifetime decision.
  reauthenticationAttempt: 0,
};

function evaluate(
  overrides: Partial<Parameters<typeof evaluateFreshness>[0]> = {},
) {
  return evaluateFreshness({
    authTime: base / 1000 - 60,
    resetState: state,
    operatorCutoffMs: null,
    transaction: normal,
    nowMs: base + 700,
    ...overrides,
  });
}

describe("T27/T28 callback freshness policy", () => {
  it.each(["aegyo", "arcade", "daebak"])(
    "%s contract rejects pre-reset SSO without any old local-session input",
    () => {
      expect(evaluate()).toEqual({
        kind: "reauthenticate",
        reason: "stale_authentication",
        maxAgeSeconds: 0,
        reauthenticationAttempt: 1,
        notBeforeMs: base + 1000,
      });
    },
  );

  it("waits across the precision boundary, then accepts the single fresh login", () => {
    const first = evaluate({ authTime: base / 1000 });
    expect(first.kind).toBe("reauthenticate");
    if (first.kind !== "reauthenticate") throw new Error("Expected retry");
    expect(first.notBeforeMs).toBe(base + 1000);
    expect(
      evaluate({
        authTime: (base + 1000) / 1000,
        transaction: {
          requestedAtMs: first.notBeforeMs,
          maxAgeSeconds: first.maxAgeSeconds,
          reauthenticationAttempt: first.reauthenticationAttempt,
        },
        nowMs: base + 1400,
      }),
    ).toEqual({ kind: "allow", authenticatedAtMs: base + 1000 });
  });

  it("never admits the one- or two-second pre-reset window", () => {
    for (const secondsBefore of [0, 1, 2]) {
      expect(evaluate({ authTime: base / 1000 - secondsBefore }).kind).toBe(
        "reauthenticate",
      );
    }
  });

  it("stops after a failed interactive retry instead of looping", () => {
    expect(
      evaluate({
        transaction: {
          ...normal,
          maxAgeSeconds: 0,
          reauthenticationAttempt: 1,
        },
      }),
    ).toEqual({ kind: "deny", reason: "reauthentication_failed" });
  });

  it("does not silently change a retry to a nonzero max_age", () => {
    expect(
      evaluate({ transaction: { ...normal, reauthenticationAttempt: 1 } }),
    ).toEqual({
      kind: "deny",
      reason: "invalid_transaction",
    });
  });

  it("accepts explicit no-reset state while checking max_age", () => {
    const resetState = {
      version: 1,
      kind: "database",
      lastPasswordReset: null,
    };
    expect(evaluate({ resetState }).kind).toBe("allow");
    expect(evaluate({ resetState, authTime: base / 1000 - 301 }).kind).toBe(
      "reauthenticate",
    );
  });

  it("enforces an operator cutoff even without a password reset", () => {
    expect(
      evaluate({
        resetState: { version: 1, kind: "database", lastPasswordReset: null },
        operatorCutoffMs: resetMs,
      }).kind,
    ).toBe("reauthenticate");
  });

  it.each([
    undefined,
    null,
    "123",
    NaN,
    Infinity,
    -1,
    base / 1000 + 0.5,
    base / 1000 + 60,
  ])("rejects invalid or future auth_time %s", (authTime) => {
    expect(evaluate({ authTime })).toEqual({
      kind: "deny",
      reason: "invalid_auth_time",
    });
  });

  it.each([
    undefined,
    null,
    {},
    { version: 2, kind: "database", lastPasswordReset: null },
    { version: 1, kind: "database" },
    { ...state, lastPasswordReset: "bad-date" },
    { ...state, lastPasswordReset: "2026-02-30T12:00:00.000Z" },
    { ...state, lastPasswordReset: "2026-09-12T12:00:00.000Z" },
  ])("rejects incomplete or malformed reset state %#", (resetState) => {
    expect(evaluate({ resetState })).toEqual({
      kind: "deny",
      reason: "invalid_reset_state",
    });
  });

  it("does not mistake a social connection for a database user with no reset", () => {
    expect(
      evaluate({ resetState: { version: 1, kind: "unsupported" } }),
    ).toEqual({
      kind: "deny",
      reason: "unsupported_connection",
    });
  });

  it.each([undefined, NaN, -1, base + 1000])(
    "fails closed on unknown operator state %#",
    (cutoff) => {
      expect(evaluate({ operatorCutoffMs: cutoff as number })).toEqual({
        kind: "deny",
        reason: "invalid_operator_cutoff",
      });
    },
  );

  it("parses documented UTC timestamps without rounding down", () => {
    expect(parseResetInstant("2026-09-11T12:00:00Z")).toBe(base);
    expect(parseResetInstant("2026-09-11T12:00:00.45Z")).toBe(base + 450);
    expect(parseResetInstant("2026-09-11T12:00:00.450Z")).toBe(base + 450);
    expect(parseResetInstant("2026-09-11T12:00:00.4509Z")).toBeNull();
  });
});
