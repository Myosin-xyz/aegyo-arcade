import fixture from "./fixtures/october-2026-starters.json";

export type PublicStanding = {
  username: string;
  rank: number;
  totalPoints: number;
  topTierResults: number;
  maxDailyPoints: number;
  maxPeriodPoints: number;
};

export type DisplayRound = {
  slug: string;
  status: string;
  mode: string;
  opensAt: Date | string;
  closesAt: Date | string;
  serverNow: Date | string;
};

export function starterRoundActive(round: DisplayRound): boolean {
  const now = new Date(round.serverNow).getTime();
  return (
    process.env.ARCADE_OCTOBER_STARTERS_ENABLED !== "false" &&
    round.slug === fixture.roundSlug &&
    round.mode === "community" &&
    round.status === "open" &&
    now >= new Date(round.opensAt).getTime() &&
    now < new Date(round.closesAt).getTime()
  );
}

/** Server-only display fixtures. Never create members, attempts, ledger entries or awards. */
export function withStarterStandings(
  round: DisplayRound,
  verified: PublicStanding[],
  registeredUsernames: string[] = [],
): PublicStanding[] {
  if (!starterRoundActive(round)) return verified;

  // A real user always owns their username, including case-insensitive collisions.
  const existing = new Set(
    [...verified.map((row) => row.username), ...registeredUsernames].map(
      (name) => name.toLowerCase(),
    ),
  );
  // The real standings determine how much space remains. Never cap real players.
  const remainingSlots = Math.max(0, 20 - verified.length);
  if (remainingSlots === 0) return verified;
  const starters = fixture.entries
    .filter((row) => !existing.has(row.username.toLowerCase()))
    .sort(
      (a, b) =>
        a.totalPoints - b.totalPoints ||
        a.username.localeCompare(b.username, "en"),
    )
    .slice(0, remainingSlots);
  const rows = [
    ...verified.map((standing) => ({ standing, starter: false })),
    ...starters.map((row) => ({
      starter: true,
      standing: {
        username: row.username,
        rank: 0,
        totalPoints: row.totalPoints,
        topTierResults: 0,
        maxDailyPoints: row.maxPeriodPoints,
        maxPeriodPoints: row.maxPeriodPoints,
      },
    })),
  ];
  rows.sort(
    (a, b) =>
      b.standing.totalPoints - a.standing.totalPoints ||
      b.standing.topTierResults - a.standing.topTierResults ||
      Number(a.starter) - Number(b.starter) ||
      a.standing.rank - b.standing.rank ||
      a.standing.username.localeCompare(b.standing.username, "en"),
  );
  let rank = 0;
  return rows.map((row, index) => {
    const previous = rows[index - 1];
    const tied =
      previous &&
      row.starter === previous.starter &&
      row.standing.totalPoints === previous.standing.totalPoints &&
      row.standing.topTierResults === previous.standing.topTierResults &&
      (row.starter || row.standing.rank === previous.standing.rank);
    if (!tied) rank = index + 1;
    // Deliberately keep internal fixture metadata out of the existing public contract.
    return { ...row.standing, rank };
  });
}
