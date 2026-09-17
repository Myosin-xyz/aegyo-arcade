import { NextRequest } from "next/server";
import { boundedBody, handle, response, UUID } from "@/competition/http";
import { competitionOperatorContext } from "@/competition/operator-auth";
import {
  closeRound,
  disqualifyAttempt,
  finalizeRound,
  fulfillAward,
  openRound,
  rejectPendingAttempt,
  settleAttempt,
  type FinalAward,
} from "@/competition/operations-store";
import type { TieReviewDecision } from "@/competition/operations";
import { CompetitionError } from "@/competition/rules";

const KEY = /^[A-Za-z0-9_-]{16,100}$/;
const AWARD_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/;

function requiredText(
  body: Record<string, unknown>,
  key: string,
  maximum = 500,
): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    throw new CompetitionError("invalid_operator_action", 400);
  return value.trim();
}

function requiredUuid(body: Record<string, unknown>, key: string): string {
  const value = requiredText(body, key, 36);
  if (!UUID.test(value))
    throw new CompetitionError("invalid_operator_action", 400);
  return value;
}

function mutationIdentity(body: Record<string, unknown>, actor: string) {
  const idempotencyKey = requiredText(body, "idempotencyKey", 100);
  if (!KEY.test(idempotencyKey))
    throw new CompetitionError("invalid_operator_action", 400);
  return { actor, idempotencyKey };
}

function requireConfirmation(
  body: Record<string, unknown>,
  expected: string,
): void {
  if (body.confirmation !== expected)
    throw new CompetitionError("operator_confirmation_required", 409);
}

function tieDecisions(value: unknown): TieReviewDecision[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new CompetitionError("invalid_operator_action", 400);
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new CompetitionError("invalid_operator_action", 400);
    const row = item as Record<string, unknown>;
    if (
      typeof row.exactTieKey !== "string" ||
      !row.exactTieKey ||
      row.exactTieKey.length > 300 ||
      row.resolution !== "shared_rank" ||
      !Array.isArray(row.memberIds) ||
      row.memberIds.length < 2 ||
      row.memberIds.length > 100 ||
      row.memberIds.some(
        (memberId) => typeof memberId !== "string" || !UUID.test(memberId),
      ) ||
      typeof row.rationale !== "string" ||
      !row.rationale.trim() ||
      row.rationale.length > 1000
    )
      throw new CompetitionError("invalid_operator_action", 400);
    return {
      exactTieKey: row.exactTieKey,
      resolution: "shared_rank" as const,
      memberIds: row.memberIds as string[],
      rationale: row.rationale.trim(),
    };
  });
}

function awards(value: unknown): FinalAward[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new CompetitionError("invalid_operator_action", 400);
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item))
      throw new CompetitionError("invalid_operator_action", 400);
    const row = item as Record<string, unknown>;
    if (
      typeof row.memberId !== "string" ||
      !UUID.test(row.memberId) ||
      typeof row.awardKey !== "string" ||
      !AWARD_KEY.test(row.awardKey) ||
      typeof row.allocationRationale !== "string" ||
      !row.allocationRationale.trim() ||
      row.allocationRationale.length > 1000
    )
      throw new CompetitionError("invalid_operator_action", 400);
    return {
      memberId: row.memberId,
      awardKey: row.awardKey,
      allocationRationale: row.allocationRationale.trim(),
    };
  });
}

export async function POST(request: NextRequest) {
  return handle(async () => {
    const context = await competitionOperatorContext(request, {
      mutation: true,
    });
    const body = await boundedBody(request, 64 * 1024);
    const action = requiredText(body, "action", 40);
    const identity = mutationIdentity(body, context.actor);

    if (action === "open") {
      const roundId = requiredUuid(body, "roundId");
      requireConfirmation(body, `open:${roundId}`);
      return response(await openRound(context.db, { roundId, ...identity }));
    }
    if (action === "close") {
      const roundId = requiredUuid(body, "roundId");
      requireConfirmation(body, `close:${roundId}`);
      const result = await closeRound(context.db, { roundId, ...identity });
      return response(
        result.kind === "snapshot"
          ? {
              kind: result.kind,
              snapshotId: result.snapshot.id,
              sourceDigest: result.snapshot.source_digest,
              standingCount: result.snapshot.standings.length,
              repeated: result.repeated,
            }
          : result,
      );
    }
    if (action === "settle") {
      const roundId = requiredUuid(body, "roundId");
      const attemptId = requiredUuid(body, "attemptId");
      requireConfirmation(body, `settle:${attemptId}`);
      return response(
        await settleAttempt(context.db, {
          roundId,
          attemptId,
          ...identity,
        }),
      );
    }
    if (action === "reject_pending") {
      const roundId = requiredUuid(body, "roundId");
      const attemptId = requiredUuid(body, "attemptId");
      requireConfirmation(body, `reject:${attemptId}`);
      return response(
        await rejectPendingAttempt(context.db, {
          roundId,
          attemptId,
          reason: requiredText(body, "reason", 500),
          ...identity,
        }),
      );
    }
    if (action === "disqualify") {
      const roundId = requiredUuid(body, "roundId");
      const attemptId = requiredUuid(body, "attemptId");
      requireConfirmation(body, `disqualify:${attemptId}`);
      return response(
        await disqualifyAttempt(context.db, {
          roundId,
          attemptId,
          reason: requiredText(body, "reason", 500),
          ...identity,
        }),
      );
    }
    if (action === "finalize") {
      const roundId = requiredUuid(body, "roundId");
      requireConfirmation(body, `finalize:${roundId}`);
      const result = await finalizeRound(context.db, {
        roundId,
        approvedBy: context.actor,
        idempotencyKey: identity.idempotencyKey,
        tieDecisions: tieDecisions(body.tieDecisions),
        awards: awards(body.awards),
      });
      return response({
        finalResultId: result.finalResultId,
        standingCount: result.standings.length,
        repeated: result.repeated,
      });
    }
    if (action === "fulfill") {
      const awardId = requiredUuid(body, "awardId");
      requireConfirmation(body, `fulfill:${awardId}`);
      return response(
        await fulfillAward(context.db, {
          awardId,
          fulfillmentKey: requiredText(body, "fulfillmentKey", 200),
          reason: requiredText(body, "reason", 500),
          ...identity,
        }),
      );
    }
    throw new CompetitionError("invalid_operator_action", 400);
  });
}
