import { describe, expect, it } from "vitest";
import {
  isResolvedCompetitionTerm,
  materialLaunchBlockers,
} from "@/competition/launch-readiness";
import { publicRules, type RoundRulesV2 } from "@/competition/rules";

const rules: RoundRulesV2 = {
  version: 2,
  mode: "material_prize",
  dailyAttempts: 2,
  attemptTtlSeconds: 900,
  cadence: "monthly",
  winnerCount: 3,
  scoring: {
    bestPerGame: "week",
    timeZone: "America/New_York",
    fullArenaBonusPoints: 20,
  },
  games: [
    {
      gameId: "perfect-toss",
      calibration: [
        { score: 0, points: 0 },
        { score: 1, points: 5 },
        { score: 8, points: 10 },
        { score: 15, points: 20 },
      ],
    },
  ],
  rulesUrl: "https://example.com/official-rules",
  approval: {
    sponsor: "Example Sponsor LLC",
    operator: "Named Promotion Administrator",
    eligibility: "Residents of Colombia age 18 or older",
    prizes: "First, second, and third-place prizes as listed by rank",
    claims: "Claim within seven days; delivery within thirty days",
    schedule: "October 1 through October 31, America/New_York",
    ties: "Published exact-tie allocation procedure T1",
    engagementSources: "Engagement points are not used in this round",
    scoring: {
      gamePoints: "Approved scoring table decision S1",
      fullArenaBonus: "Approved Full Arena decision S2",
    },
    approvedBy: "legal-review-2026-09",
  },
};

describe("material competition launch readiness", () => {
  it("accepts a fully resolved public business package", () => {
    expect(materialLaunchBlockers(rules)).toEqual([]);
    expect(materialLaunchBlockers(publicRules(rules))).toEqual([]);
  });

  it("reports explicit blockers for placeholders and missing monthly terms", () => {
    expect(
      materialLaunchBlockers({
        ...rules,
        approval: {
          ...rules.approval!,
          eligibility: "[REQUIRED: geography and age]",
          prizes: "TBD",
          ties: "Pending legal review",
          engagementSources: undefined,
          scoring: {
            gamePoints: "REQUIRED: approved game points",
            fullArenaBonus: "TBD",
          },
          approvedBy: "placeholder",
        },
      }),
    ).toEqual([
      "approval_authority",
      "eligibility_geography_age",
      "prize_allocation",
      "game_point_tables",
      "full_arena_bonus",
      "exact_tie_policy",
      "engagement_sources",
    ]);
  });

  it("accepts any safe configured scoring values with resolved approval references", () => {
    expect(
      materialLaunchBlockers({
        ...rules,
        scoring: { ...rules.scoring, fullArenaBonusPoints: 0 },
        games: [
          {
            gameId: "perfect-toss",
            calibration: [
              { score: 0, points: 0 },
              { score: 4, points: 7 },
              { score: 12, points: 31 },
            ],
          },
        ],
      }),
    ).toEqual([]);
  });

  it("fails closed when either structured scoring approval is missing", () => {
    expect(
      materialLaunchBlockers({
        ...rules,
        approval: {
          ...rules.approval!,
          scoring: undefined,
        },
      }),
    ).toEqual(["game_point_tables", "full_arena_bonus"]);
  });

  it("rejects standalone required placeholders without rejecting legal prose", () => {
    expect(isResolvedCompetitionTerm("Required")).toBe(false);
    expect(isResolvedCompetitionTerm("Required.")).toBe(false);
    expect(isResolvedCompetitionTerm("REQUIRED: prize allocation")).toBe(false);
    expect(
      isResolvedCompetitionTerm("Identity verification is required by law"),
    ).toBe(true);
  });
});
