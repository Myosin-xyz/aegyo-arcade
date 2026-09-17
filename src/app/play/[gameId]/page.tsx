import { competitionEnabled } from "@/competition/rules";
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
  return (
    <GameHost
      gameId={gameId}
      championshipEnabled={competitionEnabled()}
      requestedChampionshipRound={round}
    />
  );
}
