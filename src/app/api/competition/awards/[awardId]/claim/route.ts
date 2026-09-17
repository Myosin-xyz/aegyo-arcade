import { NextRequest } from "next/server";
import {
  boundedBody,
  handle,
  memberContext,
  response,
  UUID,
} from "@/competition/http";
import { claimAward } from "@/competition/operations-store";
import { CompetitionError } from "@/competition/rules";

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,100}$/;

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ awardId: string }> },
) {
  return handle(async () => {
    const ctx = await memberContext(request, { mutation: true });
    const { awardId } = await context.params;
    if (!UUID.test(awardId)) throw new CompetitionError("invalid_award", 400);
    const body = await boundedBody(request, 256);
    if (
      Object.keys(body).some(
        (key) => !["acceptedInstructions", "idempotencyKey"].includes(key),
      ) ||
      body.acceptedInstructions !== true ||
      typeof body.idempotencyKey !== "string" ||
      !IDEMPOTENCY_KEY.test(body.idempotencyKey)
    ) {
      throw new CompetitionError("invalid_claim", 400);
    }
    return response(
      await claimAward(ctx.db, {
        awardId,
        memberId: ctx.session.memberId,
        proof: { acceptedInstructions: true },
        idempotencyKey: body.idempotencyKey,
      }),
    );
  });
}
