"use client";

/**
 * Weekly cosmetic leaderboard (§8.3, META-2): top 50 + own rank from the
 * shared ranking policy. Provisional fair-play board — no material value.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { getRegistryEntry } from "@/games/registry";
import { t } from "@/i18n/t";

interface BoardRow {
  rank: number;
  handle: string;
  score: number;
  you: boolean;
}

type BoardState =
  | { kind: "loading" }
  | {
      kind: "ready";
      seasonKey: string;
      top: BoardRow[];
      me: { rank: number; score: number } | null;
    }
  | { kind: "unavailable" };

export function LeaderboardView({ gameId }: { gameId: string }) {
  const entry = getRegistryEntry(gameId);
  const [board, setBoard] = useState<BoardState>({ kind: "loading" });

  useEffect(() => {
    if (!entry) return;
    let cancelled = false;
    (async () => {
      try {
        await fetch("/api/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
        const res = await fetch(`/api/leaderboards/${gameId}`);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as {
          seasonKey: string;
          top: BoardRow[];
          me: { rank: number; score: number } | null;
        };
        if (!cancelled) setBoard({ kind: "ready", ...body });
      } catch {
        if (!cancelled) setBoard({ kind: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry, gameId]);

  if (!entry) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 p-5">
        <p>{t("host.unknownGame")}</p>
        <Link className="underline" href="/">
          {t("host.back")}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-5">
      <header className="flex items-center justify-between pt-4">
        <Link className="text-sm underline" href="/">
          {t("host.back")}
        </Link>
        <h1 className="text-lg font-extrabold">
          {t(entry.meta.titleKey)} — {t("board.title")}
        </h1>
      </header>

      {board.kind === "loading" && (
        <p className="text-sm opacity-70">{t("host.loading")}</p>
      )}
      {board.kind === "unavailable" && (
        <p className="text-sm opacity-70">{t("board.unavailable")}</p>
      )}
      {board.kind === "ready" && (
        <>
          <p className="text-xs opacity-60">{board.seasonKey}</p>
          {board.me && (
            <p className="text-sm font-semibold" data-testid="board-me">
              {t("board.yourRank", {
                rank: board.me.rank,
                score: board.me.score,
              })}
            </p>
          )}
          {board.top.length === 0 ? (
            <p className="text-sm opacity-70">{t("board.empty")}</p>
          ) : (
            <table className="w-full text-sm" data-testid="board-table">
              <thead>
                <tr className="text-left opacity-60">
                  <th className="py-1 pr-2">{t("board.rank")}</th>
                  <th className="py-1 pr-2">{t("board.player")}</th>
                  <th className="py-1 text-right">{t("board.score")}</th>
                </tr>
              </thead>
              <tbody>
                {board.top.map((row, index) => (
                  <tr
                    key={`${row.rank}-${index}`}
                    className={row.you ? "font-bold" : undefined}
                  >
                    <td className="py-1 pr-2 tabular-nums">#{row.rank}</td>
                    <td className="py-1 pr-2">
                      {row.handle}
                      {row.you ? ` (${t("board.you")})` : ""}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {row.score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      <Link
        className="mt-2 rounded-lg border px-4 py-2 text-center font-semibold"
        href={`/play/${gameId}`}
      >
        {t("board.backToGame", { title: t(entry.meta.titleKey) })}
      </Link>
    </main>
  );
}
