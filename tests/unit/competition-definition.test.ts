// @vitest-environment node
import { describe, expect, it } from "vitest";
import { materialLaunchBlockers } from "@/competition/launch-readiness";
import { validateDraftRoundDefinition } from "@/competition/operations-store";

const definition = {
  slug: "october-2026",
  opensAt: "2026-10-01T04:00:00.000Z",
  closesAt: "2026-11-01T04:00:00.000Z",
  rules: {
    version: 2,
    mode: "material_prize",
    dailyAttempts: 2,
    attemptTtlSeconds: 600,
    cadence: "monthly",
    winnerCount: 3,
    scoring: {
      bestPerGame: "week",
      timeZone: "America/New_York",
      fullArenaBonusPoints: 17,
    },
    games: [
      {
        gameId: "snake",
        calibration: [
          { score: 0, points: 0 },
          { score: 50, points: 7 },
        ],
      },
    ],
    rulesUrl: "https://arcade.aegyoarena.com/rules/october-2026",
    approval: {
      sponsor: "approved:sponsor-record",
      operator: "approved:operator-record",
      eligibility: "approved:eligibility-record",
      prizes: "approved:prize-record",
      claims: "approved:claims-record",
      approvedBy: "operator-id",
      schedule: "approved:schedule-record",
      ties: "approved:ties-record",
      engagementSources: "approved:no-engagement-sources-at-launch",
      scoring: {
        gamePoints: "approved:game-points-record",
        fullArenaBonus: "approved:full-arena-record",
      },
    },
  },
};

describe("competition round definition validation", () => {
  it("normalizes a complete configurable definition without a database", () => {
    const validated = validateDraftRoundDefinition(definition);
    expect(validated.opensAt.toISOString()).toBe(definition.opensAt);
    expect(validated.rules.version).toBe(2);
    expect(materialLaunchBlockers(validated.rules)).toEqual([]);
  });

  it("reports unresolved approvals before a database mutation", () => {
    const pending = structuredClone(definition);
    pending.rules.approval.scoring.gamePoints = "TBD";
    const validated = validateDraftRoundDefinition(pending);
    expect(materialLaunchBlockers(validated.rules)).toContain(
      "game_point_tables",
    );
  });

  it("rejects invalid schedules before a database mutation", () => {
    expect(() =>
      validateDraftRoundDefinition({
        ...definition,
        closesAt: definition.opensAt,
      }),
    ).toThrow("Round close must follow its open time");
  });
});
