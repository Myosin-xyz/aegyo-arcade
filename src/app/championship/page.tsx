import { notFound } from "next/navigation";
import { competitionEnabled } from "@/competition/rules";
import { ChampionshipPanel } from "./championship-panel";

export default function ChampionshipPage() {
  if (!competitionEnabled()) notFound();
  return <ChampionshipPanel />;
}
