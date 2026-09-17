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
    title: "Championship attempt",
    rule: "Starting uses one of your official attempts for this game today. The championship page shows the daily limit and reset time. Reloading or leaving forfeits it. Practice stays available.",
    start: "Start championship attempt",
    issuing: "Reserving attempt…",
    active: "Championship attempt in progress",
    submitting: "Saving replay…",
    pending: "Replay saved. Waiting for verification; no points awarded yet.",
    verified: "Replay verified",
    rejected: "This replay did not qualify for points.",
    error: "We couldn’t finish this step.",
    retry: "Retry the same submission",
    board: "Championship & rules",
    account: "Player account",
    points: "points",
    hint: "A verified account, username and round enrollment are required.",
  },
  "es-419": {
    title: "Intento del campeonato",
    rule: "Empezar usa uno de tus intentos oficiales de este juego por hoy. La página del campeonato muestra el límite diario y la hora de reinicio. Recargar o salir lo consume. Puedes seguir practicando.",
    start: "Iniciar intento del campeonato",
    issuing: "Reservando intento…",
    active: "Intento del campeonato en curso",
    submitting: "Guardando repetición…",
    pending: "Repetición guardada. Esperando verificación; aún sin puntos.",
    verified: "Repetición verificada",
    rejected: "Esta repetición no calificó para puntos.",
    error: "No pudimos completar este paso.",
    retry: "Reintentar el mismo envío",
    board: "Campeonato y reglas",
    account: "Cuenta de jugador",
    points: "puntos",
    hint: "Necesitas una cuenta verificada, un nombre y estar inscrito en la ronda.",
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
  return (
    <section
      className="border-b border-line bg-surface p-3 text-sm"
      aria-label={text.title}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>{text.title}</strong>
        <Link
          className="min-h-11 content-center text-brand underline"
          href="/championship"
        >
          {text.board}
        </Link>
      </div>
      <p className="mb-2 text-muted">{text.rule}</p>
      {canStart && !hasRetry && (
        <button
          type="button"
          className="btn-arcade min-h-11 px-4 py-2"
          onClick={onStart}
          disabled={phase === "issuing" || phase === "submitting"}
          data-testid="start-championship"
        >
          {phase === "issuing" ? text.issuing : text.start}
        </button>
      )}
      <p role="status" className="mt-2">
        {phase !== "idle" ? text[phase] : text.hint}
        {phase === "verified" && points !== null
          ? ` · ${points} ${text.points}`
          : ""}
      </p>
      {(phase === "error" || phase === "pending") && hasRetry && (
        <button className="btn-ghost min-h-11 px-4 py-2" onClick={onRetry}>
          {text.retry}
        </button>
      )}
      {(phase === "idle" || phase === "error") && (
        <Link
          className="inline-block min-h-11 content-center text-brand underline"
          href="/account"
        >
          {text.account}
        </Link>
      )}
    </section>
  );
}
