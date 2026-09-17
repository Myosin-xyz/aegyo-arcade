// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { boundedBody, memberContext } from "@/competition/http";
import {
  parseRules,
  assertRoundAvailable,
  pointsForScore,
  publicRules,
} from "@/competition/rules";
import { GET } from "@/app/api/competition/route";
import { POST } from "@/app/api/competition/attempts/route";
const db = vi.hoisted(() => ({ getDb: vi.fn(() => ({})) }));
vi.mock("@/db/client", () => db);
vi.mock("@/accounts/config", () => ({
  getAccountsConfig: () => ({ appOrigin: "https://arcade.example.test" }),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("championship admission boundaries", () => {
  it("default-off reads and writes return 404 without database access", async () => {
    vi.stubEnv("ARCADE_COMPETITION_ENABLED", undefined);
    for (const result of [
      await GET(new NextRequest("https://arcade.example.test/api/competition")),
      await POST(
        new NextRequest(
          "https://arcade.example.test/api/competition/attempts",
          { method: "POST" },
        ),
      ),
    ])
      expect(result.status).toBe(404);
    expect(db.getDb).not.toHaveBeenCalled();
  });
  it("rejects absent and foreign mutation origins before member-session lookup", async () => {
    vi.stubEnv("ARCADE_COMPETITION_ENABLED", "true");
    for (const origin of [undefined, "https://other.example.test"]) {
      const request = new NextRequest(
        "https://arcade.example.test/api/competition/attempts",
        { method: "POST", headers: origin ? { origin } : {} },
      );
      await expect(
        memberContext(request, { mutation: true }),
      ).rejects.toMatchObject({ code: "bad_origin", status: 403 });
    }
  });
  it("caps actual streamed bytes rather than trusting Content-Length", async () => {
    const request = new NextRequest(
      "https://arcade.example.test/api/competition",
      {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "2" },
        body: JSON.stringify({ trace: "a".repeat(2048) }),
      },
    );
    await expect(boundedBody(request, 100)).rejects.toMatchObject({
      code: "body_too_large",
      status: 413,
    });
  });
  it("refuses arrays, malformed JSON and non-JSON content", async () => {
    for (const body of ["[]", "{", "null"]) {
      await expect(
        boundedBody(
          new NextRequest("https://arcade.example.test", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body,
          }),
        ),
      ).rejects.toMatchObject({ code: "invalid_body" });
    }
    await expect(
      boundedBody(
        new NextRequest("https://arcade.example.test", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "{}",
        }),
      ),
    ).rejects.toMatchObject({ code: "invalid_body" });
  });
});
describe("published calibration and activation", () => {
  const draft = {
    version: 1,
    mode: "synthetic",
    dailyAttempts: 3,
    attemptTtlSeconds: 900,
    games: [
      {
        gameId: "snake",
        calibration: [
          { score: 0, points: 0 },
          { score: 50, points: 500 },
          { score: 100, points: 1000 },
        ],
      },
    ],
  };
  it("uses explicit point steps, caps at 1000, and rejects unapproved games", () => {
    const rules = parseRules(draft);
    expect(
      [0, 49, 50, 99, 100, 5000].map((score) =>
        pointsForScore(rules, "snake", score),
      ),
    ).toEqual([0, 0, 500, 500, 1000, 1000]);
    expect(() => pointsForScore(rules, "flappy", 50)).toThrow();
  });
  it("refuses nonmonotonic score tables and altered quota", () => {
    expect(() => parseRules({ ...draft, dailyAttempts: 4 })).toThrow();
    expect(() =>
      parseRules({
        ...draft,
        games: [
          {
            gameId: "snake",
            calibration: [
              { score: 0, points: 0 },
              { score: 100, points: 1000 },
              { score: 50, points: 500 },
            ],
          },
        ],
      }),
    ).toThrow();
  });
  it("material entries require both configured approval and a separate switch", () => {
    const rules = parseRules({
      ...draft,
      mode: "material_prize",
      rulesUrl: "https://example.test/rules",
      approval: {
        sponsor: "Fixture",
        operator: "Fixture",
        eligibility: "Fixture",
        prizes: "Fixture",
        claims: "Fixture",
        approvedBy: "Fixture",
      },
    });
    expect(() =>
      assertRoundAvailable(rules, {
        NODE_ENV: "test",
        ARCADE_COMPETITION_ENABLED: "true",
      }),
    ).toThrow("promotion_not_open");
    expect(() => parseRules({ ...draft, mode: "material_prize" })).toThrow(
      "promotion_approval_missing",
    );
    for (const rulesUrl of [
      "https://",
      "https://private@example.test/rules",
      "javascript:alert(1)",
    ]) {
      expect(() => parseRules({ ...rules, rulesUrl })).toThrow(
        "promotion_approval_missing",
      );
    }
  });
  it("publishes approved terms without the approver's identity or private metadata", () => {
    const rules = parseRules({
      ...draft,
      mode: "material_prize",
      rulesUrl: "https://example.test/rules",
      approval: {
        sponsor: "Fixture",
        operator: "Fixture",
        eligibility: "Fixture",
        prizes: "Fixture",
        claims: "Read the instructions",
        approvedBy: "private@example.test",
      },
      privateMemo: "Internal review only",
    });
    const visible = publicRules(rules);
    expect(visible.approval?.claims).toBe("Read the instructions");
    expect(JSON.stringify(visible)).not.toContain("private@example.test");
    expect(JSON.stringify(visible)).not.toContain("Internal review only");
    expect(visible.games).toEqual(draft.games);
  });
});
