import { notFound } from "next/navigation";
import { connection } from "next/server";
import { competitionEnabled } from "@/competition/rules";
import { ChampionshipPanel } from "./championship-panel";

export default async function ChampionshipPage() {
  await connection();
  if (!competitionEnabled()) notFound();
  return <ChampionshipPanel />;
}
