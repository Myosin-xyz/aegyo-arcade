import { NextRequest } from "next/server";
import { handle, response, UUID } from "@/competition/http";
import { competitionOperatorContext } from "@/competition/operator-auth";
import { competitionOperatorDashboard } from "@/competition/operator-dashboard";
import { CompetitionError } from "@/competition/rules";

export async function GET(request: NextRequest) {
  return handle(async () => {
    const context = await competitionOperatorContext(request);
    const roundId = request.nextUrl.searchParams.get("roundId") ?? undefined;
    if (roundId && !UUID.test(roundId))
      throw new CompetitionError("invalid_round", 400);
    const pendingAfterAt = request.nextUrl.searchParams.get("pendingAfterAt");
    const pendingAfterId = request.nextUrl.searchParams.get("pendingAfterId");
    if ((pendingAfterAt === null) !== (pendingAfterId === null))
      throw new CompetitionError("invalid_pending_cursor", 400);
    const pendingCursor =
      pendingAfterAt && pendingAfterId
        ? { receivedAt: pendingAfterAt, id: pendingAfterId }
        : undefined;
    if (
      pendingCursor &&
      (!Number.isFinite(Date.parse(pendingCursor.receivedAt)) ||
        !UUID.test(pendingCursor.id))
    )
      throw new CompetitionError("invalid_pending_cursor", 400);
    return response(
      await competitionOperatorDashboard(context.db, roundId, pendingCursor),
    );
  });
}
