import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { competitionEnabled } from "@/competition/rules";
import { CompetitionOperatorPanel } from "./competition-operator-panel";

export const metadata: Metadata = {
  title: "Competition operations · Aegyo Arena",
  robots: { index: false, follow: false },
};

export default async function CompetitionAdminPage() {
  await connection();
  if (!competitionEnabled()) notFound();
  return <CompetitionOperatorPanel />;
}
