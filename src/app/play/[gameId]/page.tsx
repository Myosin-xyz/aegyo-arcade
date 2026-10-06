import { cookies } from "next/headers";
import { MEMBER_COOKIE } from "@/accounts/cookies";
import { resolveMemberSession } from "@/accounts/sessions";
import {
  activeRoundForGame,
  isEnrolledForRound,
  remainingAttemptsForGame,
} from "@/competition/play-options";
import { competitionEnabled } from "@/competition/rules";
import { getDb } from "@/db/client";
import { GameHost } from "@/shell/host";

export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ gameId: string }>;
  searchParams: Promise<{ championship?: string }>;
}) {
  const { gameId } = await params;
  const query = await searchParams;
  const round =
    typeof query.championship === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      query.championship,
    )
      ? query.championship
      : null;
  const championshipEnabled = competitionEnabled();
  let discoveredRound: string | null = null;
  let monthlyJoinAvailable = false;
  let monthlyAttemptsRemaining: number | null = null;
  if (championshipEnabled) {
    const db = getDb();
    if (db) {
      try {
        const candidateRound = round ?? (await activeRoundForGame(db, gameId));
        if (candidateRound) {
          const token = (await cookies()).get(MEMBER_COOKIE)?.value;
          const session = token ? await resolveMemberSession(db, token) : null;
          const enrolled =
            session?.emailVerified === true &&
            (await isEnrolledForRound(db, candidateRound, session.memberId));
          if (!round) {
            monthlyJoinAvailable = !enrolled;
            if (enrolled) discoveredRound = candidateRound;
          }
          if (enrolled) {
            monthlyAttemptsRemaining = await remainingAttemptsForGame(
              db,
              candidateRound,
              session.memberId,
              gameId,
            );
          }
        }
      } catch {
        // Daily play and practice must remain available if discovery fails.
        discoveredRound = null;
        monthlyJoinAvailable = false;
        monthlyAttemptsRemaining = null;
      }
    }
  }
  return (
    <GameHost
      gameId={gameId}
      championshipEnabled={championshipEnabled}
      requestedChampionshipRound={round ?? discoveredRound}
      monthlyJoinAvailable={monthlyJoinAvailable}
      monthlyAttemptsRemaining={monthlyAttemptsRemaining}
    />
  );
}
