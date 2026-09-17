import { NextRequest } from "next/server";
import {
  boundedBody,
  handle,
  memberContext,
  response,
  UUID,
} from "@/competition/http";
import { CompetitionError } from "@/competition/rules";
import { enroll } from "@/competition/store";
export async function POST(request: NextRequest) {
  return handle(async () => {
    const ctx = await memberContext(request, { mutation: true });
    const body = await boundedBody(request);
    if (
      typeof body.roundId !== "string" ||
      !UUID.test(body.roundId) ||
      typeof body.acceptedRulesDigest !== "string"
    )
      throw new CompetitionError("invalid_body", 400);
    return response(
      await enroll(ctx.db, ctx.session, body.roundId, body.acceptedRulesDigest),
    );
  });
}
