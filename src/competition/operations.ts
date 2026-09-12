export type StandingContribution = {
  memberId: string;
  points: number;
  dayKey: string;
  receivedAt: Date;
};

export type CandidateStanding = {
  memberId: string;
  totalPoints: number;
  maxUtcDailyPoints: number;
  reachedFinalTotalAt: string;
  provisionalRank: number;
  exactTieKey: string | null;
  requiresReview: boolean;
};

export type TieReviewDecision = {
  exactTieKey: string;
  resolution: "shared_rank";
  memberIds: string[];
  rationale: string;
};

export type FinalStanding = CandidateStanding & {
  finalRank: number;
};

type Aggregate = Omit<
  CandidateStanding,
  "provisionalRank" | "exactTieKey" | "requiresReview"
>;

function assertContribution(value: StandingContribution): void {
  if (!Number.isSafeInteger(value.points) || value.points < 0) {
    throw new Error("Competition points must be a non-negative safe integer");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value.dayKey)) {
    throw new Error("Competition day keys must be UTC YYYY-MM-DD values");
  }
  if (Number.isNaN(value.receivedAt.getTime())) {
    throw new Error("Competition receipt time is invalid");
  }
}

/**
 * Build the immutable candidate order from current daily-best contributions.
 * Zero-point members are intentionally absent. memberId is never a tie-breaker.
 */
export function rankCandidateStandings(
  contributions: readonly StandingContribution[],
): CandidateStanding[] {
  const members = new Map<
    string,
    { total: number; days: Map<string, number>; reachedAt: Date }
  >();

  for (const value of contributions) {
    assertContribution(value);
    if (value.points === 0) continue;
    const current = members.get(value.memberId) ?? {
      total: 0,
      days: new Map<string, number>(),
      reachedAt: value.receivedAt,
    };
    current.total += value.points;
    if (!Number.isSafeInteger(current.total)) {
      throw new Error("Competition point total exceeds the safe integer range");
    }
    current.days.set(
      value.dayKey,
      (current.days.get(value.dayKey) ?? 0) + value.points,
    );
    if (value.receivedAt > current.reachedAt)
      current.reachedAt = value.receivedAt;
    members.set(value.memberId, current);
  }

  const aggregates: Aggregate[] = [...members.entries()].map(
    ([memberId, value]) => ({
      memberId,
      totalPoints: value.total,
      maxUtcDailyPoints: Math.max(...value.days.values()),
      // The final positive daily-best contribution is when the member reaches
      // the total represented by this snapshot.
      reachedFinalTotalAt: value.reachedAt.toISOString(),
    }),
  );

  aggregates.sort(
    (a, b) =>
      b.totalPoints - a.totalPoints ||
      b.maxUtcDailyPoints - a.maxUtcDailyPoints ||
      Date.parse(a.reachedFinalTotalAt) - Date.parse(b.reachedFinalTotalAt),
  );

  const result: CandidateStanding[] = [];
  for (let index = 0; index < aggregates.length;) {
    const first = aggregates[index];
    let end = index + 1;
    while (
      end < aggregates.length &&
      aggregates[end].totalPoints === first.totalPoints &&
      aggregates[end].maxUtcDailyPoints === first.maxUtcDailyPoints &&
      aggregates[end].reachedFinalTotalAt === first.reachedFinalTotalAt
    ) {
      end += 1;
    }
    const tied = end - index > 1;
    const tieKey = tied
      ? `${first.totalPoints}:${first.maxUtcDailyPoints}:${first.reachedFinalTotalAt}`
      : null;
    for (let cursor = index; cursor < end; cursor += 1) {
      result.push({
        ...aggregates[cursor],
        provisionalRank: index + 1,
        exactTieKey: tieKey,
        requiresReview: tied,
      });
    }
    index = end;
  }
  return result;
}

/** Confirm exact ties without introducing a hidden tie-break or arbitrary order. */
export function applyTieReview(
  candidates: readonly CandidateStanding[],
  decisions: readonly TieReviewDecision[],
): FinalStanding[] {
  if (
    new Set(decisions.map((item) => item.exactTieKey)).size !== decisions.length
  ) {
    throw new Error("Exact tie review contains duplicate decisions");
  }
  const requiredKeys = new Set(
    candidates.flatMap((item) => (item.exactTieKey ? [item.exactTieKey] : [])),
  );
  if (decisions.some((item) => !requiredKeys.has(item.exactTieKey))) {
    throw new Error("Exact tie review contains an unknown tie");
  }
  const decisionByKey = new Map(
    decisions.map((item) => [item.exactTieKey, item]),
  );
  const ordered: CandidateStanding[] = [];

  for (let index = 0; index < candidates.length;) {
    const candidate = candidates[index];
    if (!candidate.exactTieKey) {
      ordered.push(candidate);
      index += 1;
      continue;
    }
    const group = candidates.filter(
      (item) => item.exactTieKey === candidate.exactTieKey,
    );
    const decision = decisionByKey.get(candidate.exactTieKey);
    if (!decision || !decision.rationale.trim()) {
      throw new Error(`Exact tie ${candidate.exactTieKey} requires review`);
    }
    const expected = new Set(group.map((item) => item.memberId));
    if (decision.resolution !== "shared_rank") {
      throw new Error(
        `Exact tie ${candidate.exactTieKey} must retain shared rank`,
      );
    }
    const reviewed = new Set(decision.memberIds);
    if (
      reviewed.size !== expected.size ||
      decision.memberIds.length !== expected.size ||
      decision.memberIds.some((memberId) => !expected.has(memberId))
    ) {
      throw new Error(
        `Exact tie ${candidate.exactTieKey} review is incomplete`,
      );
    }
    ordered.push(...group);
    index += group.length;
  }

  return ordered.map((item) => ({ ...item, finalRank: item.provisionalRank }));
}
