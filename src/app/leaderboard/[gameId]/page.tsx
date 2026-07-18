import { LeaderboardView } from "./view";

export default async function LeaderboardPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return <LeaderboardView gameId={gameId} />;
}
