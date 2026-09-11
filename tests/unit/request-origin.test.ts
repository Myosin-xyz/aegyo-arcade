// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { canonicalExternalRequestUrl } from "@/server/request-origin";
import { sameOriginOk } from "@/app/api/_shared/http";

const external = "https://arcade.example.test";
const previousOrigin = process.env.ARCADE_APP_ORIGIN;
const invalidForwarding: Array<Record<string, string>> = [
  { "x-forwarded-host": "attacker.example.test" },
  { "x-forwarded-host": "arcade.example.test, attacker.example.test" },
  { "x-forwarded-proto": "http" },
];

beforeAll(() => {
  process.env.ARCADE_APP_ORIGIN = external;
});
afterAll(() => {
  if (previousOrigin === undefined) delete process.env.ARCADE_APP_ORIGIN;
  else process.env.ARCADE_APP_ORIGIN = previousOrigin;
});

function proxied(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(
    "http://arcade-auth-preview.railway.internal/api/session?proof=1",
    {
      method: "POST",
      headers: {
        host: "arcade-auth-preview.railway.internal",
        "x-forwarded-host": "arcade.example.test",
        "x-forwarded-proto": "https",
        ...headers,
      },
    },
  );
}

describe("canonical external request origin", () => {
  it("rebases only path and query onto the configured HTTPS origin", () => {
    expect(canonicalExternalRequestUrl(proxied(), external)?.href).toBe(
      "https://arcade.example.test/api/session?proof=1",
    );
  });

  it("preserves the configured authority when the observed path starts with slashes", () => {
    const request = new NextRequest(
      "http://arcade-auth-preview.railway.internal//attacker.example/path?proof=1",
      {
        headers: {
          host: "arcade-auth-preview.railway.internal",
          "x-forwarded-host": "arcade.example.test",
          "x-forwarded-proto": "https",
        },
      },
    );
    const canonical = canonicalExternalRequestUrl(request, external);
    expect(canonical?.origin).toBe(external);
    expect(canonical?.pathname).toBe("//attacker.example/path");
    expect(canonical?.search).toBe("?proof=1");
  });

  it("accepts the expected browser Origin behind the verified proxy host", () => {
    expect(sameOriginOk(proxied({ origin: external }))).toBe(true);
  });

  it("rejects an attacker Origin even when the proxy host is correct", () => {
    expect(
      sameOriginOk(proxied({ origin: "https://attacker.example.test" })),
    ).toBe(false);
  });

  it.each(invalidForwarding)(
    "rejects spoofed or ambiguous forwarding authority %#",
    (headers) => {
      expect(
        canonicalExternalRequestUrl(proxied(headers), external),
      ).toBeNull();
    },
  );

  it("preserves the direct-host behavior used outside a reverse proxy", () => {
    const request = new NextRequest(`${external}/api/session`, {
      headers: { host: "arcade.example.test", origin: external },
    });
    expect(canonicalExternalRequestUrl(request, external)?.origin).toBe(
      external,
    );
    expect(sameOriginOk(request)).toBe(true);
  });

  it("fails closed for an invalid explicitly configured origin", () => {
    expect(
      canonicalExternalRequestUrl(proxied(), "ftp://localhost"),
    ).toBeNull();
    expect(
      canonicalExternalRequestUrl(
        proxied(),
        "https://arcade.example.test/path",
      ),
    ).toBeNull();
  });

  it("uses the request URL only when no canonical origin is configured", () => {
    const request = new NextRequest("https://legacy.example.test/api/session");
    expect(canonicalExternalRequestUrl(request, "")?.href).toBe(
      "https://legacy.example.test/api/session",
    );
  });
});
