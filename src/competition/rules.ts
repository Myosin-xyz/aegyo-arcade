/** Versioned championship rules. No default prizes or production round. */
export type CompetitionGame = "snake" | "flappy" | "perfect-toss" | "hangman";
export type CalibrationPoint = { score: number; points: number };
const COMPETITION_GAMES = new Set<CompetitionGame>([
  "snake",
  "flappy",
  "perfect-toss",
  "hangman",
]);
const V1_COMPETITION_GAMES = new Set<CompetitionGame>(["snake", "flappy"]);
const V2_MATERIAL_COMPETITION_GAMES = new Set<CompetitionGame>([
  "snake",
  "flappy",
  "perfect-toss",
]);
const V2_COMMUNITY_COMPETITION_GAMES = new Set<CompetitionGame>([
  "snake",
  "flappy",
  "perfect-toss",
]);
const MAX_CONFIGURED_POINTS = 1000;
type CompetitionScoringApproval = {
  /** Reviewed source for every game's frozen score-to-points table. */
  gamePoints: string;
  /** Reviewed source for the frozen Full Arena bonus, including zero. */
  fullArenaBonus: string;
};
type CompetitionApproval = {
  sponsor: string;
  operator: string;
  eligibility: string;
  prizes: string;
  claims: string;
  approvedBy: string;
  /** Public schedule wording, including the controlling time zone. */
  schedule?: string;
  /** Published handling for exact ties, including prize-position ties. */
  ties?: string;
  /** Published sources, caps, and verification rules for engagement points. */
  engagementSources?: string;
  /** References proving the configured game and bonus values were approved. */
  scoring?: CompetitionScoringApproval;
};
type CommonRoundRules = {
  mode: "synthetic" | "community" | "material_prize";
  dailyAttempts: number;
  attemptTtlSeconds: number;
  games: { gameId: CompetitionGame; calibration: CalibrationPoint[] }[];
  rulesUrl?: string;
  approval?: CompetitionApproval;
};
export type RoundRulesV1 = CommonRoundRules & {
  version: 1;
  dailyAttempts: 3;
};
export type RoundRulesV2 = CommonRoundRules & {
  version: 2;
  dailyAttempts: 2;
  cadence: "monthly";
  winnerCount: 3;
  scoring: {
    bestPerGame: "week";
    timeZone: string;
    fullArenaBonusPoints: number;
  };
};
export type RoundRules = RoundRulesV1 | RoundRulesV2;
type Publicize<T extends RoundRules> = Omit<T, "approval"> & {
  approval?: Omit<CompetitionApproval, "approvedBy">;
};
export type PublicRoundRules =
  Publicize<RoundRulesV1> | Publicize<RoundRulesV2>;
/** Explicit public projection: operator approval identities and extra metadata stay private. */
export function publicRules(rules: RoundRules): PublicRoundRules {
  const result = {
    version: rules.version,
    mode: rules.mode,
    dailyAttempts: rules.dailyAttempts,
    attemptTtlSeconds: rules.attemptTtlSeconds,
    games: rules.games.map((game) => ({
      gameId: game.gameId,
      calibration: game.calibration.map(({ score, points }) => ({
        score,
        points,
      })),
    })),
    ...(rules.rulesUrl ? { rulesUrl: rules.rulesUrl } : {}),
    ...(rules.approval
      ? {
          approval: {
            sponsor: rules.approval.sponsor,
            operator: rules.approval.operator,
            eligibility: rules.approval.eligibility,
            prizes: rules.approval.prizes,
            claims: rules.approval.claims,
            ...(rules.approval.schedule
              ? { schedule: rules.approval.schedule }
              : {}),
            ...(rules.approval.ties ? { ties: rules.approval.ties } : {}),
            ...(rules.approval.engagementSources
              ? { engagementSources: rules.approval.engagementSources }
              : {}),
            ...(rules.approval.scoring
              ? { scoring: { ...rules.approval.scoring } }
              : {}),
          },
        }
      : {}),
  };
  return (
    rules.version === 2
      ? {
          ...result,
          cadence: rules.cadence,
          winnerCount: rules.winnerCount,
          scoring: { ...rules.scoring },
        }
      : result
  ) as PublicRoundRules;
}
function isPublicHttpsUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
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
function isTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
export function parseRules(input: unknown): RoundRules {
  const rules = input as RoundRules | null;
  if (
    !rules ||
    ![1, 2].includes(rules.version) ||
    !["synthetic", "community", "material_prize"].includes(rules.mode) ||
    !Number.isInteger(rules.attemptTtlSeconds) ||
    rules.attemptTtlSeconds < 60 ||
    rules.attemptTtlSeconds > 900 ||
    !Array.isArray(rules.games) ||
    !rules.games.length ||
    rules.games.length > COMPETITION_GAMES.size
  )
    throw new CompetitionError("invalid_round_rules", 400);
  if (
    (rules.version === 1 && rules.dailyAttempts !== 3) ||
    (rules.version === 2 && rules.dailyAttempts !== 2) ||
    (rules.mode === "community" && rules.version !== 2)
  )
    throw new CompetitionError("invalid_round_rules", 400);
  if (
    rules.version === 2 &&
    (rules.cadence !== "monthly" ||
      rules.winnerCount !== 3 ||
      rules.scoring?.bestPerGame !== "week" ||
      !isTimeZone(rules.scoring.timeZone) ||
      !Number.isSafeInteger(rules.scoring.fullArenaBonusPoints) ||
      rules.scoring.fullArenaBonusPoints < 0 ||
      rules.scoring.fullArenaBonusPoints > MAX_CONFIGURED_POINTS)
  )
    throw new CompetitionError("invalid_round_rules", 400);
  const seen = new Set<string>();
  for (const game of rules.games) {
    const eligibleGames =
      rules.version === 1
        ? V1_COMPETITION_GAMES
        : rules.mode === "material_prize"
          ? V2_MATERIAL_COMPETITION_GAMES
          : rules.mode === "community"
            ? V2_COMMUNITY_COMPETITION_GAMES
            : COMPETITION_GAMES;
    if (
      !game ||
      !eligibleGames.has(game.gameId) ||
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
        !item ||
        !Number.isSafeInteger(item.score) ||
        item.score < 0 ||
        item.score <= score ||
        !Number.isSafeInteger(item.points) ||
        item.points < 0 ||
        item.points > MAX_CONFIGURED_POINTS ||
        item.points < points
      )
        throw new CompetitionError("invalid_calibration", 400);
      score = item.score;
      points = item.points;
    }
    if (
      game.calibration[0].score !== 0 ||
      game.calibration[0].points !== 0 ||
      (rules.version === 1 ? points !== 1000 : points <= 0)
    )
      throw new CompetitionError("invalid_calibration", 400);
  }
  if (rules.mode === "material_prize") {
    const approval = rules.approval;
    const requiredApprovalKeys = [
      "sponsor",
      "operator",
      "eligibility",
      "prizes",
      "claims",
      "approvedBy",
    ] as const;
    if (
      !isPublicHttpsUrl(rules.rulesUrl) ||
      !approval ||
      requiredApprovalKeys.some(
        (key) => typeof approval[key] !== "string" || !approval[key].trim(),
      ) ||
      (["schedule", "ties", "engagementSources"] as const).some(
        (key) =>
          approval[key] !== undefined && typeof approval[key] !== "string",
      ) ||
      (approval.scoring !== undefined &&
        (!approval.scoring ||
          typeof approval.scoring !== "object" ||
          Array.isArray(approval.scoring) ||
          typeof approval.scoring.gamePoints !== "string" ||
          typeof approval.scoring.fullArenaBonus !== "string"))
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
/** Highest frozen tier for a verified game best; bonuses and engagement never qualify. */
export function isTopTierResult(
  rules: RoundRules,
  gameId: string,
  points: number,
): boolean {
  const game = rules.games.find((item) => item.gameId === gameId);
  return Boolean(
    game && points > 0 && points === game.calibration.at(-1)?.points,
  );
}
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
function localDay(now: Date, timeZone: string): string {
  if (Number.isNaN(now.getTime()))
    throw new CompetitionError("invalid_clock", 503);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    calendar: "iso8601",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value);
  const year = read("year");
  const month = read("month");
  const day = read("day");
  if (![year, month, day].every(Number.isInteger))
    throw new CompetitionError("invalid_clock", 503);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
export function competitionAttemptDayKey(rules: RoundRules, now: Date): string {
  return rules.version === 2
    ? localDay(now, rules.scoring.timeZone)
    : utcDay(now);
}
export function competitionScorePeriodKey(
  rules: RoundRules,
  now: Date,
): string {
  if (rules.version === 1) return utcDay(now);
  const [year, month, day] = localDay(now, rules.scoring.timeZone)
    .split("-")
    .map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const daysSinceMonday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceMonday);
  return utcDay(date);
}
export function fullArenaBonusPoints(rules: RoundRules): number {
  return rules.version === 2 ? rules.scoring.fullArenaBonusPoints : 0;
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
