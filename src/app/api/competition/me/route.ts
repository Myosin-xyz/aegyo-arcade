import { NextRequest } from "next/server";
import { handle, memberContext, response, UUID } from "@/competition/http";
import { CompetitionError } from "@/competition/rules";
import { memberRound } from "@/competition/read";
export async function GET(request: NextRequest) {
  return handle(async () => {
    const ctx = await memberContext(request);
    const roundId = request.nextUrl.searchParams.get("roundId");
    if (!roundId || !UUID.test(roundId))
      throw new CompetitionError("invalid_round", 400);
    return response(
      await memberRound(
        ctx.db,
        ctx.session.memberId,
        ctx.session.emailVerified,
        roundId,
      ),
    );
  });
}
