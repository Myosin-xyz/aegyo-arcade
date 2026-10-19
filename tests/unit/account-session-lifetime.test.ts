// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const config = vi.hoisted(() => ({
  providerBaseUrl: "https://id.example.test",
  issuer: "https://id.example.test/api/auth",
  clientId: "arcade",
  clientSecret: "oauth-secret",
  appOrigin: "https://arcade.example.test",
  transactionSecret: "x".repeat(32),
  stateReaderKey: "reader-secret",
}));

vi.mock("openid-client", () => ({
  discovery: vi.fn(async () => ({ discovered: true })),
  ClientSecretBasic: vi.fn(() => "client-auth"),
  randomPKCECodeVerifier: vi.fn(() => "v".repeat(43)),
  randomState: vi.fn(() => "state-state-state-state"),
  randomNonce: vi.fn(() => "nonce-nonce-nonce-nonce"),
  calculatePKCECodeChallenge: vi.fn(async () => "challenge"),
  buildAuthorizationUrl: vi.fn(
    () => new URL("https://id.example.test/authorize"),
  ),
  enableNonRepudiationChecks: vi.fn(),
  clockTolerance: Symbol("clockTolerance"),
}));
vi.mock("@/accounts/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/accounts/config")>()),
  getAccountsConfig: () => config,
}));

import {
  memberSessionTtlSeconds,
  MOBILE_SESSION_TTL_SECONDS,
  parseAccountClient,
  WEB_SESSION_TTL_SECONDS,
} from "@/accounts/config";
import { MEMBER_COOKIE, OIDC_TRANSACTION_COOKIE } from "@/accounts/cookies";
import { setMemberCookie } from "@/accounts/http";
import { createMemberSession } from "@/accounts/sessions";
import { openTransaction, sealTransaction } from "@/accounts/transaction";
import type { Db } from "@/db/client";
import { GET as login } from "@/app/api/accounts/login/route";

async function loginTransaction(query: string) {
  const response = await login(
    new Request(`https://arcade.example.test/api/accounts/login${query}`),
  );
  expect(response.status).toBe(307);
  return openTransaction(
    response.cookies.get(OIDC_TRANSACTION_COOKIE)?.value,
    config.transactionSecret,
  );
}

describe("member session lifetime by client", () => {
  it("uses 1 day for web and 90 days for mobile", () => {
    expect(WEB_SESSION_TTL_SECONDS).toBe(86_400);
    expect(MOBILE_SESSION_TTL_SECONDS).toBe(7_776_000);
    expect(memberSessionTtlSeconds("web")).toBe(WEB_SESSION_TTL_SECONDS);
    expect(memberSessionTtlSeconds("mobile")).toBe(MOBILE_SESSION_TTL_SECONDS);
  });

  it.each([
    ["mobile", "mobile"],
    [null, "web"],
    [undefined, "web"],
    ["web", "web"],
    ["Mobile", "web"],
    ["mobile ", "web"],
    ["ios", "web"],
    ["", "web"],
  ])("parses client %j as %s", (value, expected) => {
    expect(parseAccountClient(value)).toBe(expected);
  });

  it("stores client=mobile from the login entry in the sealed transaction", async () => {
    const transaction = await loginTransaction(
      "?returnTo=%2Faccount&client=mobile",
    );
    expect(transaction).toMatchObject({
      client: "mobile",
      returnTo: "/account",
      maxAgeSeconds: 3_600,
    });
  });

  it("defaults the login transaction to web without a client parameter", async () => {
    expect(await loginTransaction("?returnTo=%2Faccount")).toMatchObject({
      client: "web",
      returnTo: "/account",
    });
  });

  it.each(["desktop", "MOBILE", "mobile,web", "1"])(
    "defaults the login transaction to web for client=%s",
    async (value) => {
      expect(
        await loginTransaction(`?client=${encodeURIComponent(value)}`),
      ).toMatchObject({ client: "web" });
    },
  );

  it("opens a pre-upgrade transaction without client as web and rejects an unknown sealed value", () => {
    const now = Date.now();
    const legacy = {
      state: "state-state-state-state",
      nonce: "nonce-nonce-nonce-nonce",
      codeVerifier: "v".repeat(43),
      requestedAtMs: now,
      maxAgeSeconds: 3_600,
      reauthenticationAttempt: 0 as const,
      returnTo: "/account",
    };
    const secret = config.transactionSecret;
    const sealedLegacy = sealTransaction(
      legacy as Parameters<typeof sealTransaction>[0],
      secret,
    );
    expect(openTransaction(sealedLegacy, secret, now)?.client).toBe("web");
    const sealedBogus = sealTransaction(
      { ...legacy, client: "tablet" } as unknown as Parameters<
        typeof sealTransaction
      >[0],
      secret,
    );
    expect(openTransaction(sealedBogus, secret, now)).toBeNull();
  });

  it.each([
    ["web", 86_400],
    ["mobile", 7_776_000],
  ] as const)(
    "sets the %s member cookie maxAge to the session TTL",
    (client, seconds) => {
      const response = NextResponse.redirect("https://arcade.example.test/");
      setMemberCookie(response, "member-token", {
        maxAge: memberSessionTtlSeconds(client),
      });
      const cookie = response.cookies.get(MEMBER_COOKIE);
      expect(cookie).toMatchObject({
        value: "member-token",
        maxAge: seconds,
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
      });
      expect(response.headers.get("set-cookie")).toContain(
        `Max-Age=${seconds}`,
      );
    },
  );

  it.each([
    ["web", 86_400],
    ["mobile", 7_776_000],
  ] as const)(
    "stores a %s session row that expires after the TTL",
    async (client, seconds) => {
      const rows: Array<Record<string, unknown>> = [];
      const tx = {
        insert: () => ({
          values: (value: Record<string, unknown>) => {
            rows.push(value);
            return {
              onConflictDoUpdate: () => ({
                returning: async () => [{ id: "member-1" }],
              }),
            };
          },
        }),
      };
      const db = {
        transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx),
      } as unknown as Db;
      const now = new Date("2026-10-19T12:00:00.000Z");
      const created = await createMemberSession(
        db,
        {
          issuer: config.issuer,
          subject: "user-1",
          providerSessionId: "sid-1",
          name: null,
          picture: null,
          authenticatedAtMs: now.getTime(),
          securityVersion: 7,
          resetState: {
            version: 1,
            kind: "database",
            lastPasswordReset: null,
          },
          now,
        },
        { ttlSeconds: memberSessionTtlSeconds(client) },
      );
      expect(created.expiresAt.getTime() - now.getTime()).toBe(seconds * 1000);
      expect(rows[1]?.expiresAt).toEqual(created.expiresAt);
    },
  );
});
