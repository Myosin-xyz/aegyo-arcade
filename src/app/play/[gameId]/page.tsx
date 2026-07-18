import { GameHost } from "@/shell/host";

export default async function PlayPage({
  params,
}: {
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  return <GameHost gameId={gameId} />;
}
