/**
 * Cosmetic leaderboard seasons (META-2): weekly, reset Monday 00:00 UTC.
 * Season key is the ISO-8601 week of the submission instant, e.g.
 * "2026-W29". Standard ISO week algorithm (week 1 contains Jan 4).
 */

export function seasonKeyFor(at: Date): string {
  const d = new Date(
    Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()),
  );
  // Shift to the Thursday of the current ISO week.
  const dayFromMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayFromMonday + 3);
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayFromMonday = (jan4.getUTCDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayFromMonday);
  const week =
    1 +
    Math.round(
      (d.getTime() - week1Monday.getTime()) / (7 * 24 * 60 * 60 * 1000) - 0.5,
    );
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}
