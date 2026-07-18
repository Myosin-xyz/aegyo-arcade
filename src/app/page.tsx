import Link from "next/link";
import { listGames } from "@/games/registry";
import { t } from "@/i18n/t";
import { StreakStrip } from "./streak-strip";

export default function Home() {
  const games = listGames();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 p-5">
      <header className="pt-4 text-center">
        <h1 className="text-2xl font-extrabold">{t("portal.title")}</h1>
        <p className="text-sm opacity-70">{t("portal.tagline")}</p>
      </header>
      <StreakStrip />
      <ul className="grid grid-cols-2 gap-3">
        {games.map((game) => (
          <li key={game.meta.id}>
            <Link
              href={`/play/${game.meta.id}`}
              // §15: game-card route prefetch stays OFF — RSC prefetches
              // were firing on landing (M0 review), paid-traffic transfer.
              prefetch={false}
              className="block rounded-2xl border p-4 shadow-sm transition-transform active:scale-95"
              data-testid={`game-card-${game.meta.id}`}
            >
              <h2 className="font-bold">{t(game.meta.titleKey)}</h2>
              <p className="mt-1 text-xs opacity-70">
                {t(game.meta.taglineKey)}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
