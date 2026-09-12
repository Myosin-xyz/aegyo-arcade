/** Versioned championship rules. No default prizes or production round. */
export type CompetitionGame = "snake" | "flappy";
export type CalibrationPoint = { score: number; points: number };
export type RoundRules = {
  version: 1;
  mode: "synthetic" | "material_prize";
  dailyAttempts: 3;
  attemptTtlSeconds: number;
  games: { gameId: CompetitionGame; calibration: CalibrationPoint[] }[];
  rulesUrl?: string;
  approval?: {
    sponsor: string;
    operator: string;
    eligibility: string;
    prizes: string;
    claims: string;
    approvedBy: string;
  };
};
export class CompetitionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 409,
  ) {
    super(code);
  }
}
export const competitionEnabled = (env: NodeJS.ProcessEnv = process.env) =>
  env.ARCADE_COMPETITION_ENABLED === "true";
export function parseRules(input: unknown): RoundRules {
  const rules = input as RoundRules | null;
  if (
    !rules ||
    rules.version !== 1 ||
    !["synthetic", "material_prize"].includes(rules.mode) ||
    rules.dailyAttempts !== 3 ||
    !Number.isInteger(rules.attemptTtlSeconds) ||
    rules.attemptTtlSeconds < 60 ||
    rules.attemptTtlSeconds > 900 ||
    !Array.isArray(rules.games) ||
    !rules.games.length ||
    rules.games.length > 2
  )
    throw new CompetitionError("invalid_round_rules", 400);
  const seen = new Set<string>();
  for (const game of rules.games) {
    if (
      !game ||
      !["snake", "flappy"].includes(game.gameId) ||
      seen.has(game.gameId) ||
      !Array.isArray(game.calibration) ||
      game.calibration.length < 2 ||
      game.calibration.length > 50
    )
      throw new CompetitionError("invalid_calibration", 400);
    seen.add(game.gameId);
    let score = -1,
      points = -1;
    for (const item of game.calibration) {
      if (
        !Number.isSafeInteger(item.score) ||
        item.score < 0 ||
        item.score <= score ||
        !Number.isSafeInteger(item.points) ||
        item.points < 0 ||
        item.points > 1000 ||
        item.points < points
      )
        throw new CompetitionError("invalid_calibration", 400);
      score = item.score;
      points = item.points;
    }
    if (
      game.calibration[0].score !== 0 ||
      game.calibration[0].points !== 0 ||
      points !== 1000
    )
      throw new CompetitionError("invalid_calibration", 400);
  }
  if (rules.mode === "material_prize") {
    if (
      !rules.rulesUrl?.startsWith("https://") ||
      !rules.approval ||
      [
        "sponsor",
        "operator",
        "eligibility",
        "prizes",
        "claims",
        "approvedBy",
      ].some(
        (key) =>
          typeof rules.approval?.[
            key as keyof NonNullable<RoundRules["approval"]>
          ] !== "string" ||
          !rules.approval[
            key as keyof NonNullable<RoundRules["approval"]>
          ].trim(),
      )
    )
      throw new CompetitionError("promotion_approval_missing", 409);
  }
  return rules;
}
/** Published step table: never invent interpolation or use raw game maxima. */
export function pointsForScore(
  rules: RoundRules,
  gameId: string,
  score: number,
): number {
  if (!Number.isSafeInteger(score) || score < 0)
    throw new CompetitionError("invalid_verified_score", 400);
  const game = rules.games.find((item) => item.gameId === gameId);
  if (!game) throw new CompetitionError("ineligible_game", 400);
  return (
    [...game.calibration].reverse().find((item) => item.score <= score)
      ?.points ?? 0
  );
}
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
export function assertRoundAvailable(
  rules: RoundRules,
  env: NodeJS.ProcessEnv = process.env,
): void {
  parseRules(rules);
  if (!competitionEnabled(env)) throw new CompetitionError("not_found", 404);
  if (
    rules.mode === "material_prize" &&
    env.ARCADE_MATERIAL_COMPETITION_ENABLED !== "true"
  )
    throw new CompetitionError("promotion_not_open", 409);
}
