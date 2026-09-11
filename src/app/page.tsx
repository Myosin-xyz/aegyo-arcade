import { connection } from "next/server";
import { listGames } from "@/games/registry";
import { shuffleGameOrder } from "./game-order";
import { HomeContent } from "./home-content";

export default async function Home() {
  // This page is deliberately request-rendered: the shuffle belongs in the
  // delivered HTML so cards never jump after hydration. Client navigation
  // back to a cached homepage keeps its existing order; a fresh visit gets a
  // new arcade shelf.
  await connection();

  const gameOrder = shuffleGameOrder(listGames().map((game) => game.meta.id));
  const sharedAuthEnabled = process.env.ARCADE_SHARED_AUTH_ENABLED === "true";

  return (
    <HomeContent gameOrder={gameOrder} sharedAuthEnabled={sharedAuthEnabled} />
  );
}
