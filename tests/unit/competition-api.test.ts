// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { boundedBody, memberContext } from "@/competition/http";
import {
  assertRoundAvailable,
  competitionAttemptDayKey,
  competitionScorePeriodKey,
  fullArenaBonusPoints,
  parseRules,
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
  const tierCalibration = [
    { score: 0, points: 0 },
    { score: 1, points: 5 },
    { score: 8, points: 10 },
    { score: 15, points: 20 },
  ];
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
    expect(() =>
      parseRules({
        ...draft,
        mode: "material_prize",
        rulesUrl: "https://example.test/rules",
        approval: {
          sponsor: "Fixture",
          operator: "Fixture",
          eligibility: "Fixture",
          prizes: "Fixture",
          approvedBy: "Fixture",
        },
      }),
    ).toThrow("promotion_approval_missing");
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
  it("supports a monthly round made from New York weekly bests", () => {
    const rules = parseRules({
      ...draft,
      version: 2,
      dailyAttempts: 2,
      cadence: "monthly",
      winnerCount: 3,
      games: [{ gameId: "snake", calibration: tierCalibration }],
      scoring: {
        bestPerGame: "week",
        timeZone: "America/New_York",
        fullArenaBonusPoints: 20,
      },
    });
    const sundayNight = new Date("2026-09-07T03:59:59Z");
    const mondayStart = new Date("2026-09-07T04:00:00Z");
    expect(competitionAttemptDayKey(rules, sundayNight)).toBe("2026-09-06");
    expect(competitionScorePeriodKey(rules, sundayNight)).toBe("2026-08-31");
    expect(competitionAttemptDayKey(rules, mondayStart)).toBe("2026-09-07");
    expect(competitionScorePeriodKey(rules, mondayStart)).toBe("2026-09-07");
    expect(fullArenaBonusPoints(rules)).toBe(20);
    expect(publicRules(rules)).toMatchObject({
      version: 2,
      cadence: "monthly",
      winnerCount: 3,
      scoring: {
        bestPerGame: "week",
        timeZone: "America/New_York",
        fullArenaBonusPoints: 20,
      },
    });
  });
  it("accepts frozen monotonic point tables and more than two eligible games in v2 only", () => {
    const approvedCalibration = [
      { score: 0, points: 0 },
      { score: 1, points: 7 },
      { score: 8, points: 19 },
      { score: 15, points: 31 },
    ];
    const rules = parseRules({
      ...draft,
      version: 2,
      dailyAttempts: 2,
      cadence: "monthly",
      winnerCount: 3,
      games: [
        { gameId: "snake", calibration: approvedCalibration },
        { gameId: "flappy", calibration: approvedCalibration },
        { gameId: "perfect-toss", calibration: approvedCalibration },
      ],
      scoring: {
        bestPerGame: "week",
        timeZone: "America/New_York",
        fullArenaBonusPoints: 47,
      },
    });

    expect(rules.games).toHaveLength(3);
    expect(
      [0, 1, 7, 8, 14, 15, 100].map((score) =>
        pointsForScore(rules, "perfect-toss", score),
      ),
    ).toEqual([0, 7, 7, 19, 19, 31, 31]);
    expect(() =>
      parseRules({
        ...draft,
        games: [{ gameId: "perfect-toss", calibration: tierCalibration }],
      }),
    ).toThrow("invalid_calibration");
    expect(
      parseRules({
        ...rules,
        games: draft.games,
      }).games[0]?.calibration.at(-1)?.points,
    ).toBe(1000);

    expect(
      parseRules({
        ...rules,
        games: [{ gameId: "hangman", calibration: tierCalibration }],
      }).games[0]?.gameId,
    ).toBe("hangman");
    expect(() =>
      parseRules({
        ...rules,
        games: [
          {
            gameId: "snake",
            calibration: [
              { score: 0, points: 0 },
              { score: 5, points: 0 },
            ],
          },
        ],
      }),
    ).toThrow("invalid_calibration");
    for (const points of [-1, 7.5, 1001]) {
      expect(() =>
        parseRules({
          ...rules,
          games: [
            {
              gameId: "snake",
              calibration: [
                { score: 0, points: 0 },
                { score: 5, points },
              ],
            },
          ],
        }),
      ).toThrow("invalid_calibration");
    }
    expect(() =>
      parseRules({
        ...rules,
        games: [
          {
            gameId: "snake",
            calibration: [
              { score: 0, points: 0 },
              { score: 5, points: 20 },
              { score: 10, points: 19 },
            ],
          },
        ],
      }),
    ).toThrow("invalid_calibration");
    expect(() =>
      parseRules({
        ...rules,
        mode: "material_prize",
        rulesUrl: "https://example.test/rules",
        approval: {
          sponsor: "Fixture sponsor",
          operator: "Fixture operator",
          eligibility: "Adults in an approved region",
          prizes: "Three prizes allocated by rank",
          claims: "Claim within seven days",
          approvedBy: "Fixture approver",
        },
        games: [{ gameId: "hangman", calibration: tierCalibration }],
      }),
    ).toThrow("invalid_calibration");
  });
  it("rejects malformed monthly scoring configuration", () => {
    for (const scoring of [
      {
        bestPerGame: "day",
        timeZone: "America/New_York",
        fullArenaBonusPoints: 20,
      },
      {
        bestPerGame: "week",
        timeZone: "Not/AZone",
        fullArenaBonusPoints: 20,
      },
      {
        bestPerGame: "week",
        timeZone: "America/New_York",
        fullArenaBonusPoints: 1001,
      },
      {
        bestPerGame: "week",
        timeZone: "America/New_York",
        fullArenaBonusPoints: -1,
      },
      {
        bestPerGame: "week",
        timeZone: "America/New_York",
        fullArenaBonusPoints: 1.5,
      },
    ]) {
      expect(() =>
        parseRules({
          ...draft,
          version: 2,
          dailyAttempts: 2,
          cadence: "monthly",
          winnerCount: 3,
          games: [{ gameId: "snake", calibration: tierCalibration }],
          scoring,
        }),
      ).toThrow("invalid_round_rules");
    }
  });

  it("rejects malformed structured scoring approvals", () => {
    expect(() =>
      parseRules({
        ...draft,
        version: 2,
        mode: "material_prize",
        dailyAttempts: 2,
        cadence: "monthly",
        winnerCount: 3,
        games: [{ gameId: "snake", calibration: tierCalibration }],
        scoring: {
          bestPerGame: "week",
          timeZone: "America/New_York",
          fullArenaBonusPoints: 0,
        },
        rulesUrl: "https://example.test/rules",
        approval: {
          sponsor: "Fixture sponsor",
          operator: "Fixture operator",
          eligibility: "Adults in an approved region",
          prizes: "Three prizes allocated by rank",
          claims: "Claim within seven days",
          scoring: "not-structured",
          approvedBy: "Fixture approver",
        },
      }),
    ).toThrow("promotion_approval_missing");
  });
});
