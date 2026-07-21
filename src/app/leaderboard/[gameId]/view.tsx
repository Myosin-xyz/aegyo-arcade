"use client";

/**
 * Weekly cosmetic leaderboard (§8.3, META-2): top 50 + own rank from the
 * shared ranking policy. Provisional fair-play board — no material value.
 */

import Link from "next/link";
import { useEffect, useState } from "react";
import { getRegistryEntry } from "@/games/registry";
import { t } from "@/i18n/t";
import { bootstrapSession } from "@/shell/session";
import { useLocaleReady } from "@/app/locale-boundary";

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
  const localeReady = useLocaleReady();
  const [board, setBoard] = useState<BoardState>({ kind: "loading" });

  useEffect(() => {
    // Session bootstrap waits for the resolved locale (M4 review P1).
    if (!entry || !localeReady) return;
    let cancelled = false;
    (async () => {
      try {
        await bootstrapSession();
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
  }, [entry, gameId, localeReady]);

  if (!entry) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 p-5">
        <p>{t("host.unknownGame")}</p>
        <Link className="btn-ghost px-5 py-2 text-sm font-semibold" href="/">
          {t("host.back")}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 p-5">
      <header className="flex items-center justify-between pt-4">
        <Link className="text-sm font-bold text-brand" href="/">
          {t("host.back")}
        </Link>
        <h1 className="font-arcade glow-brand text-sm font-bold uppercase text-brand">
          {t(entry.meta.titleKey)} — {t("board.title")}
        </h1>
      </header>

      {board.kind === "loading" && (
        <p className="text-sm text-muted">{t("host.loading")}</p>
      )}
      {board.kind === "unavailable" && (
        <p className="text-sm text-muted">{t("board.unavailable")}</p>
      )}
      {board.kind === "ready" && (
        <>
          <p className="text-xs text-muted">{board.seasonKey}</p>
          {board.me && (
            <p
              className="card-arcade px-4 py-2.5 text-sm font-semibold text-gold"
              data-testid="board-me"
            >
              {t("board.yourRank", {
                rank: board.me.rank,
                score: board.me.score,
              })}
            </p>
          )}
          {board.top.length === 0 ? (
            <p className="text-sm text-muted">{t("board.empty")}</p>
          ) : (
            <table
              className="card-arcade w-full table-fixed overflow-hidden text-sm"
              data-testid="board-table"
            >
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-muted">
                  <th className="w-14 px-3 py-2">{t("board.rank")}</th>
                  <th className="py-2 pr-2">{t("board.player")}</th>
                  <th className="w-20 py-2 pr-3 text-right">
                    {t("board.score")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {board.top.map((row, index) => (
                  <tr
                    key={`${row.rank}-${index}`}
                    className={row.you ? "font-bold text-brand" : undefined}
                  >
                    <td
                      className={`px-3 py-1.5 tabular-nums ${row.rank <= 3 ? "font-bold text-gold" : ""}`}
                    >
                      #{row.rank}
                    </td>
                    {/* Curated handles can be long — truncate so one
                        never widens the phone column (audit B6). */}
                    <td className="truncate py-1.5 pr-2">
                      {row.handle}
                      {row.you ? ` (${t("board.you")})` : ""}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
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
