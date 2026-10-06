import { notFound } from "next/navigation";
import { connection } from "next/server";
import { competitionEnabled } from "@/competition/rules";
import { ChampionshipPanel } from "./championship-panel";

const ROUND_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;
const GAME_ID = /^(snake|flappy|perfect-toss|hangman|no-cap)$/;

export default async function ChampionshipPage({
  searchParams,
}: {
  searchParams: Promise<{
    round?: string | string[];
    game?: string | string[];
  }>;
}) {
  await connection();
  if (!competitionEnabled()) notFound();
  const { round: candidate, game } = await searchParams;
  const selectedRound =
    typeof candidate === "string" && ROUND_SLUG.test(candidate)
      ? candidate
      : undefined;
  const returnGameId =
    typeof game === "string" && GAME_ID.test(game) ? game : undefined;
  return (
    <ChampionshipPanel
      selectedRound={selectedRound}
      returnGameId={returnGameId}
    />
  );
}
