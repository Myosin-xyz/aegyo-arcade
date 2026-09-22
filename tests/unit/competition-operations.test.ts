import { describe, expect, it } from "vitest";
import {
  applyTieReview,
  materialPrizeAllocationIssue,
  rankCandidateStandings,
  type StandingContribution,
} from "@/competition/operations";

const at = (value: string) => new Date(value);

describe("competition candidate standings", () => {
  it("uses total points, most top-tier game results, then receipt reaching the final total", () => {
    const rows: StandingContribution[] = [
      {
        memberId: "later",
        dayKey: "2026-09-01",
        points: 40,
        receivedAt: at("2026-09-01T01:00:00Z"),
      },
      {
        memberId: "later",
        dayKey: "2026-09-02",
        points: 60,
        topTierResults: 1,
        receivedAt: at("2026-09-03T01:00:00Z"),
      },
      {
        memberId: "earlier",
        dayKey: "2026-09-01",
        points: 40,
        receivedAt: at("2026-09-01T02:00:00Z"),
      },
      {
        memberId: "earlier",
        dayKey: "2026-09-02",
        points: 60,
        topTierResults: 1,
        receivedAt: at("2026-09-02T02:00:00Z"),
      },
      {
        memberId: "daily",
        dayKey: "2026-09-01",
        points: 70,
        receivedAt: at("2026-09-03T02:00:00Z"),
      },
      {
        memberId: "daily",
        dayKey: "2026-09-02",
        points: 30,
        receivedAt: at("2026-09-03T03:00:00Z"),
      },
      {
        memberId: "zero",
        dayKey: "2026-09-01",
        points: 0,
        receivedAt: at("2026-09-01T00:00:00Z"),
      },
    ];

    expect(rankCandidateStandings(rows).map((row) => row.memberId)).toEqual([
      "earlier",
      "later",
      "daily",
    ]);
    expect(
      rankCandidateStandings(rows, "legacy_daily").map((row) => row.memberId),
    ).toEqual(["daily", "earlier", "later"]);
  });

  it("keeps an exact tie shared and provisional instead of using member identity", () => {
    const receivedAt = at("2026-09-01T01:00:00Z");
    const ranked = rankCandidateStandings([
      { memberId: "z", dayKey: "2026-09-01", points: 10, receivedAt },
      { memberId: "a", dayKey: "2026-09-01", points: 10, receivedAt },
    ]);
    expect(ranked.map((row) => row.provisionalRank)).toEqual([1, 1]);
    expect(ranked.every((row) => row.requiresReview)).toBe(true);
    expect(ranked[0].exactTieKey).toBe(ranked[1].exactTieKey);
  });

  it("requires explicit review and retains a shared final rank", () => {
    const receivedAt = at("2026-09-01T01:00:00Z");
    const candidates = rankCandidateStandings([
      { memberId: "a", dayKey: "2026-09-01", points: 10, receivedAt },
      { memberId: "b", dayKey: "2026-09-01", points: 10, receivedAt },
    ]);
    expect(() => applyTieReview(candidates, [])).toThrow(/requires review/);
    const exactTieKey = candidates[0].exactTieKey!;
    expect(
      applyTieReview(candidates, [
        {
          exactTieKey,
          resolution: "shared_rank",
          memberIds: ["b", "a"],
          rationale: "Published shared-placement rule R1",
        },
      ]).map((row) => [row.memberId, row.finalRank]),
    ).toEqual([
      ["a", 1],
      ["b", 1],
    ]);
    expect(() =>
      applyTieReview(candidates, [
        {
          exactTieKey,
          resolution: "shared_rank",
          memberIds: ["a", "b"],
          rationale: "one",
        },
        {
          exactTieKey,
          resolution: "shared_rank",
          memberIds: ["a", "b"],
          rationale: "two",
        },
      ]),
    ).toThrow(/duplicate/);
  });

  it("fails closed on prize-position ties and incomplete monthly allocations", () => {
    const base = {
      totalPoints: 20,
      topTierResults: 0,
      maxUtcDailyPoints: 20,
      reachedFinalTotalAt: "2026-09-01T01:00:00.000Z",
      requiresReview: false,
    };
    const clear = [
      {
        ...base,
        memberId: "one",
        provisionalRank: 1,
        finalRank: 1,
        exactTieKey: null,
      },
      {
        ...base,
        memberId: "two",
        provisionalRank: 2,
        finalRank: 2,
        exactTieKey: null,
      },
      {
        ...base,
        memberId: "three",
        provisionalRank: 3,
        finalRank: 3,
        exactTieKey: null,
      },
    ];
    expect(materialPrizeAllocationIssue(clear, [], 3)).toBe(
      "prize_allocation_required",
    );
    expect(
      materialPrizeAllocationIssue(
        clear,
        clear.map(({ memberId }) => ({ memberId })),
        3,
      ),
    ).toBeNull();
    expect(
      materialPrizeAllocationIssue(
        clear.slice(0, 2),
        clear.slice(0, 2).map(({ memberId }) => ({ memberId })),
        3,
      ),
    ).toBeNull();
    expect(materialPrizeAllocationIssue([], [], 3)).toBeNull();
    expect(
      materialPrizeAllocationIssue(
        [
          ...clear.slice(0, 2),
          { ...clear[2], exactTieKey: "20:20:time", requiresReview: true },
        ],
        clear.map(({ memberId }) => ({ memberId })),
        3,
      ),
    ).toBe("exact_tie_policy_required");
  });
});
