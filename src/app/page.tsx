"use client";

// Client component so t() resolves the CLIENT locale (§12.1) — a server
// render would pin the page to English forever.
import Link from "next/link";
import type { CSSProperties } from "react";
import { listGames } from "@/games/registry";
import { GAME_ACCENTS, PALETTE } from "@/shell/palette";
import { t } from "@/i18n/t";
import { StreakStrip } from "./streak-strip";
import { AegyoLogo } from "./logo";
import { LocaleToggle } from "./locale-toggle";

export default function Home() {
  const games = listGames();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 pb-[max(3rem,env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)]">
      <header className="flex flex-col items-center gap-2 pt-10 text-center">
        <AegyoLogo className="h-16 w-16 drop-shadow-[0_0_18px_rgba(255,79,139,0.45)]" />
        <h1 className="font-arcade glow-brand text-xl font-bold uppercase text-brand">
          {t("portal.title")}
        </h1>
        <p className="text-sm text-muted">{t("portal.tagline")}</p>
      </header>
      <StreakStrip />
      <ul className="grid grid-cols-2 gap-3">
        {games.map((game, index) => {
          const accent = GAME_ACCENTS[game.meta.id] ?? PALETTE.brand;
          return (
            <li
              key={game.meta.id}
              className={index === 0 ? "col-span-2" : "min-h-0"}
            >
              <Link
                href={`/play/${game.meta.id}`}
                // §15: game-card route prefetch stays OFF — RSC prefetches
                // were firing on landing (M0 review), paid-traffic transfer.
                prefetch={false}
                className="card-arcade block h-full p-4 transition-[transform,border-color] active:scale-95"
                style={{ "--game-accent": accent } as CSSProperties}
                data-testid={`game-card-${game.meta.id}`}
              >
                <span
                  aria-hidden
                  className="mb-2.5 block h-1.5 w-8 rounded-full"
                  style={{
                    background: accent,
                    boxShadow: `0 0 12px ${accent}`,
                  }}
                />
                <h2 className="font-bold leading-tight">
                  {t(game.meta.titleKey)}
                </h2>
                <p className="mt-1 text-xs leading-snug text-muted">
                  {t(game.meta.taglineKey)}
                </p>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto flex flex-col items-center gap-2 pt-4">
        <Link
          href="/install"
          className="inline-flex min-h-11 items-center px-2 text-xs font-semibold text-muted underline-offset-4 hover:underline"
        >
          {t("install.link")}
        </Link>
        <LocaleToggle />
        <p className="text-center font-arcade text-[0.625rem] uppercase tracking-wider text-muted">
          {t("portal.title")}
        </p>
      </div>
    </main>
  );
}
