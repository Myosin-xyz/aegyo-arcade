// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import fixture from "../../src/competition/fixtures/october-2026-starters.json";
import {
  withStarterStandings,
  type PublicStanding,
} from "../../src/competition/starter-standings";

const round = {
  slug: fixture.roundSlug,
  mode: "community",
  status: "open",
  opensAt: "2026-10-06T20:40:00Z",
  closesAt: "2026-11-01T04:00:00Z",
  serverNow: "2026-10-20T21:30:00Z",
};
const player = (
  username: string,
  totalPoints: number,
  rank = 1,
): PublicStanding => ({
  username,
  totalPoints,
  rank,
  topTierResults: 0,
  maxDailyPoints: totalPoints,
  maxPeriodPoints: totalPoints,
});
afterEach(() => vi.unstubAllEnvs());

describe("October presentation standings", () => {
  it("adds 20 stable names with a symmetric 1–15 point spread without changing real score rows", () => {
    const verified = [player("real_player", 5)];
    const original = structuredClone(verified);
    const result = withStarterStandings(round, verified);
    expect(result).toHaveLength(21);
    expect(verified).toEqual(original);
    expect(result.find((row) => row.username === "real_player")).toEqual({
      ...original[0],
      rank: 17,
    });
    expect(
      fixture.entries.reduce((total, row) => total + row.totalPoints, 0),
    ).toBe(160);
    expect(new Set(result.map((row) => row.username)).size).toBe(21);
    expect(result[0].totalPoints).toBe(15);
    expect(result.at(-1)?.totalPoints).toBe(1);
    expect(withStarterStandings(round, verified)).toEqual(result);
    expect(result.every((row) => row.maxPeriodPoints <= row.totalPoints)).toBe(
      true,
    );
    expect(Object.keys(result[0]).sort()).toEqual([
      "maxDailyPoints",
      "maxPeriodPoints",
      "rank",
      "topTierResults",
      "totalPoints",
      "username",
    ]);
  });

  it("preserves genuine ties and gives genuine players precedence at equal points", () => {
    const verified = [player("alice", 10), player("bob", 10)];
    const result = withStarterStandings(round, verified);
    expect(
      result
        .filter((row) => ["alice", "bob"].includes(row.username))
        .map((row) => row.rank),
    ).toEqual([5, 5]);
    expect(
      result.filter((row) => row.totalPoints === 10).map((row) => row.rank),
    ).toEqual([5, 5, 7, 7]);
  });

  it("never impersonates an existing registered username, even before that player scores", () => {
    const name = fixture.entries[0].username;
    expect(withStarterStandings(round, [], [name.toUpperCase()])).toHaveLength(
      19,
    );
    const result = withStarterStandings(round, [player(name, 30)]);
    expect(result).toHaveLength(20);
    expect(result[0]).toEqual(player(name, 30));
  });

  it("leaves other rounds, official finals and the closed period untouched", () => {
    const verified = [player("real_player", 5)];
    for (const changed of [
      { slug: "september-2026-community-leaderboard" },
      { mode: "material_prize" },
      { mode: "synthetic" },
      { status: "final" },
      { status: "review" },
      { serverNow: round.closesAt },
      { serverNow: "2026-10-01T00:00:00Z" },
    ])
      expect(withStarterStandings({ ...round, ...changed }, verified)).toBe(
        verified,
      );
    vi.stubEnv("ARCADE_OCTOBER_STARTERS_ENABLED", "false");
    expect(withStarterStandings(round, verified)).toBe(verified);
  });
});
