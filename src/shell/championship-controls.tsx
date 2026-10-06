"use client";
import Link from "next/link";
import { getLocale } from "@/i18n/t";
export type ChampionshipPhase =
  | "idle"
  | "issuing"
  | "active"
  | "submitting"
  | "pending"
  | "verified"
  | "rejected"
  | "error";
const copy = {
  en: {
    title: "Monthly leaderboard",
    rule: "Uses one official attempt. Leaving or reloading forfeits it.",
    start: "Play for monthly leaderboard",
    issuing: "Reserving attempt…",
    active: "Leaderboard run in progress · don't leave",
    submitting: "Saving replay…",
    pending: "Replay saved. Waiting for verification; no points awarded yet.",
    verified: "Replay verified",
    rejected: "This replay did not qualify for points.",
    error: "Couldn't finish. Check your account or try again.",
    retry: "Retry the same submission",
    board: "Leaderboard",
    account: "Account",
    points: "points",
    readying: "Getting the game ready…",
  },
  "es-419": {
    title: "Tabla mensual",
    rule: "Usa un intento oficial. Salir o recargar lo consume.",
    start: "Jugar para la tabla mensual",
    issuing: "Reservando intento…",
    active: "Partida de tabla mensual en curso · no salgas",
    submitting: "Guardando repetición…",
    pending: "Repetición guardada. Esperando verificación; aún sin puntos.",
    verified: "Repetición verificada",
    rejected: "Esta repetición no calificó para puntos.",
    error: "No pudimos terminar. Revisa tu cuenta o inténtalo de nuevo.",
    retry: "Reintentar el mismo envío",
    board: "Clasificación",
    account: "Cuenta",
    points: "puntos",
    readying: "Preparando el juego…",
  },
};
export function ChampionshipControls({
  phase,
  canStart,
  points,
  onStart,
  onRetry,
  hasRetry,
}: {
  phase: ChampionshipPhase;
  canStart: boolean;
  points: number | null;
  onStart: () => void;
  onRetry: () => void;
  hasRetry: boolean;
}) {
  const text = copy[getLocale()];
  const showStart = canStart && !hasRetry;
  const status = phase === "idle" ? text.readying : text[phase];
  return (
    <section
      className="border-b border-line bg-surface px-3 py-2 text-xs"
      aria-label={text.title}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {showStart ? (
          <button
            type="button"
            className="btn-arcade min-h-11 px-3 py-2"
            onClick={onStart}
            disabled={phase === "issuing" || phase === "submitting"}
            data-testid="start-championship"
          >
            {phase === "issuing" ? text.issuing : text.start}
          </button>
        ) : (
          <strong role="status" className="min-w-0 flex-1 leading-snug">
            {status}
            {phase === "verified" && points !== null
              ? ` · ${points} ${text.points}`
              : ""}
          </strong>
        )}
        <Link
          className="ml-auto flex min-h-11 items-center text-brand underline"
          href="/championship"
        >
          {text.board}
        </Link>
      </div>
      {showStart && <p className="mt-1 leading-snug text-muted">{text.rule}</p>}
      {showStart && phase !== "idle" && (
        <p role="status" className="mt-1 leading-snug">
          {status}
          {phase === "verified" && points !== null
            ? ` · ${points} ${text.points}`
            : ""}
        </p>
      )}
      {(phase === "error" || phase === "pending") && hasRetry && (
        <button className="btn-ghost mt-1 min-h-11 px-3 py-2" onClick={onRetry}>
          {text.retry}
        </button>
      )}
      {phase === "error" && !hasRetry && (
        <Link
          className="ml-3 inline-flex min-h-11 items-center text-brand underline"
          href="/account"
        >
          {text.account}
        </Link>
      )}
    </section>
  );
}
