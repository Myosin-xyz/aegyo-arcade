import { NextRequest } from "next/server";
import { competitionDatabase, handle, response } from "@/competition/http";
import { publicRound } from "@/competition/read";
export async function GET(request: NextRequest) {
  return handle(async () =>
    response(
      await publicRound(
        competitionDatabase(),
        request.nextUrl.searchParams.get("round") ?? undefined,
      ),
    ),
  );
}
