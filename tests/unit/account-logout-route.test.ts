// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  revokeMemberSession: vi.fn(),
  config: {
    appOrigin: "https://arcade.aegyoarena.com",
    providerBaseUrl: "https://account.aegyoarena.com",
  },
}));

vi.mock("@/accounts/config", () => ({ getAccountsConfig: () => mocks.config }));
vi.mock("@/accounts/sessions", () => ({
  revokeMemberSession: mocks.revokeMemberSession,
}));
vi.mock("@/db/client", () => ({ getDb: () => ({ database: true }) }));

import { POST } from "@/app/api/accounts/logout/route";

function request(origin: string, cookie = ""): NextRequest {
  return new NextRequest(`${origin}/api/accounts/logout`, {
    method: "POST",
    headers: cookie ? { cookie } : {},
  });
}

describe("Arcade browser sign-out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.config.appOrigin = "https://arcade.aegyoarena.com";
  });

  it("revokes the member session and clears only Arcade member cookies before the first-party redirect", async () => {
    const response = await POST(
      request(
        "https://arcade.aegyoarena.com",
        "__Host-aegyo_member=member-token; arcade_device=guest-device",
      ),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      next: "https://account.aegyoarena.com/sign-out?return=arcade",
    });
    expect(mocks.revokeMemberSession).toHaveBeenCalledWith(
      { database: true },
      "member-token",
    );
    const cleared = response.headers.get("set-cookie") ?? "";
    expect(cleared).toContain("__Host-aegyo_member=");
    expect(cleared).toContain("__Host-aegyo_oidc_tx=");
    expect(cleared).not.toContain("arcade_device");
  });

  it("does not route a preview host into the live sign-out chain", async () => {
    const response = await POST(request("https://preview.example.test"));
    expect(await response.json()).toEqual({ ok: true });
  });
});
