import { NextRequest } from "next/server";
import {
  boundedBody,
  handle,
  memberContext,
  response,
  UUID,
} from "@/competition/http";
import { CompetitionError } from "@/competition/rules";
import { issueAttempt } from "@/competition/store";
export async function POST(request: NextRequest) {
  return handle(async () => {
    const ctx = await memberContext(request, { mutation: true });
    const body = await boundedBody(request);
    if (
      typeof body.roundId !== "string" ||
      !UUID.test(body.roundId) ||
      typeof body.gameId !== "string" ||
      typeof body.idempotencyKey !== "string"
    )
      throw new CompetitionError("invalid_body", 400);
    return response(
      await issueAttempt(
        ctx.db,
        ctx.session,
        {
          roundId: body.roundId,
          gameId: body.gameId,
          idempotencyKey: body.idempotencyKey,
        },
        process.env.ARCADE_COMPETITION_SEED_SECRET ?? "",
      ),
    );
  });
}
