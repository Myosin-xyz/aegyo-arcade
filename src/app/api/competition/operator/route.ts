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
    return response(await competitionOperatorDashboard(context.db, roundId));
  });
}
