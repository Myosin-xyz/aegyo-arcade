import { notFound } from "next/navigation";
import { connection } from "next/server";
import { competitionEnabled } from "@/competition/rules";
import { ChampionshipPanel } from "./championship-panel";

const ROUND_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export default async function ChampionshipPage({
  searchParams,
}: {
  searchParams: Promise<{ round?: string | string[] }>;
}) {
  await connection();
  if (!competitionEnabled()) notFound();
  const candidate = (await searchParams).round;
  const selectedRound =
    typeof candidate === "string" && ROUND_SLUG.test(candidate)
      ? candidate
      : undefined;
  return <ChampionshipPanel selectedRound={selectedRound} />;
}
