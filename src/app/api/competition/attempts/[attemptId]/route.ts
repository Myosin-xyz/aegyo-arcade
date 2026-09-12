import { NextRequest } from "next/server";
import {
  boundedBody,
  handle,
  memberContext,
  response,
  UUID,
} from "@/competition/http";
import { CompetitionError } from "@/competition/rules";
import { receiveTrace, verifyAttempt } from "@/competition/store";
export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ attemptId: string }> },
) {
  return handle(async () => {
    const ctx = await memberContext(request, {
      mutation: true,
      quarantine: true,
    });
    const { attemptId } = await context.params;
    if (!UUID.test(attemptId))
      throw new CompetitionError("invalid_attempt", 400);
    const body = await boundedBody(request, 256 * 1024);
    if (!body.trace || typeof body.trace !== "object")
      throw new CompetitionError("invalid_trace", 400);
    const receipt = await receiveTrace(
      ctx.db,
      ctx.session,
      attemptId,
      body.trace,
      ctx.securityConfirmed,
    );
    if (!ctx.securityConfirmed)
      return response(
        {
          ...receipt,
          status: receipt.status,
          verification: "waiting_for_identity",
        },
        202,
      );
    return response(await verifyAttempt(ctx.db, attemptId));
  });
}
