"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { RoundRules } from "@/competition/rules";
import { getLocale } from "@/i18n/t";
import { AegyoLogo } from "../logo";
import styles from "./championship.module.css";

type Standing = {
  username: string;
  rank: number;
  totalPoints: number;
  maxDailyPoints: number;
};
type Round = {
  id: string;
  slug: string;
  status: string;
  opensAt: string;
  closesAt: string;
  mode: "synthetic" | "material_prize";
  rules: RoundRules;
  rulesDigest: string;
};
type PublicState = {
  round: Round | null;
  standings?: Standing[];
  provisional?: boolean;
};
type Attempt = {
  id: string;
  gameId: string;
  status: string;
  score: number | null;
  points: number | null;
  dayKey: string;
};
type MemberState = {
  enrolled: boolean;
  username: string | null;
  emailVerified: boolean;
  attempts: Attempt[];
  remaining: { snake: number; flappy: number };
  totalPoints: number;
  rank: number | null;
};
type LoadState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; publicState: PublicState; member: MemberState | null };

const translations = {
  en: {
    eyebrow: "Monthly challenge",
    title: "Championship",
    intro:
      "Play the official daily challenges and climb the monthly standings.",
    test: "Test round · no prizes",
    loading: "Loading the championship…",
    unavailable: "The championship is unavailable right now.",
    retry: "Try again",
    noRound: "There isn’t an active round yet. Check back soon.",
    closes: "Closes",
    provisional: "Standings are provisional while results are reviewed.",
    standings: "Standings",
    player: "Player",
    points: "Points",
    bestDay: "Best day",
    empty: "No verified scores yet.",
    yourRound: "Your round",
    signedOut: "Sign in to enroll and play official attempts.",
    account: "Open my account",
    setup: "Choose a username and verify your email before enrolling.",
    enrolled: "You’re enrolled",
    notEnrolled: "Join this round",
    accept: "I’ve reviewed and accept the rules for this round.",
    enroll: "Enroll",
    enrolling: "Enrolling…",
    rulesChanged: "The rules changed. Review them again before enrolling.",
    enrollmentFailed:
      "We couldn’t confirm enrollment. Check your status before trying again.",
    total: "Total points",
    rank: "Rank",
    attempts: "Attempts left today",
    playSnake: "Play Snake",
    playFlappy: "Play Flappy Bird",
    recent: "Recent attempts",
    score: "Score",
    rules: "Rules for this round",
    utc: "Daily limits reset at 00:00 UTC.",
    three: "You receive three official attempts per game each UTC day.",
    reserve:
      "An attempt is reserved when play starts. Reloading or leaving forfeits it.",
    expiry: "Each attempt expires after 15 minutes or when the round closes.",
    guest: "Earlier guest or practice scores do not count.",
    scoring:
      "Points use the published score steps below; scores between steps use the lower step.",
    game: "Game",
    rawScore: "Game score",
    roundPoints: "Round points",
    home: "Back to games",
  },
  "es-419": {
    eyebrow: "Reto mensual",
    title: "Campeonato",
    intro: "Juega los retos diarios oficiales y sube en la tabla mensual.",
    test: "Ronda de prueba · sin premios",
    loading: "Cargando el campeonato…",
    unavailable: "El campeonato no está disponible en este momento.",
    retry: "Intentar de nuevo",
    noRound: "Todavía no hay una ronda activa. Vuelve pronto.",
    closes: "Cierra",
    provisional: "La tabla es provisional mientras se revisan los resultados.",
    standings: "Clasificación",
    player: "Jugador",
    points: "Puntos",
    bestDay: "Mejor día",
    empty: "Aún no hay puntajes verificados.",
    yourRound: "Tu ronda",
    signedOut: "Inicia sesión para inscribirte y jugar intentos oficiales.",
    account: "Abrir mi cuenta",
    setup: "Elige un nombre y verifica tu correo antes de inscribirte.",
    enrolled: "Ya estás inscrito",
    notEnrolled: "Únete a esta ronda",
    accept: "Revisé y acepto las reglas de esta ronda.",
    enroll: "Inscribirme",
    enrolling: "Inscribiendo…",
    rulesChanged:
      "Las reglas cambiaron. Revísalas de nuevo antes de inscribirte.",
    enrollmentFailed:
      "No pudimos confirmar la inscripción. Revisa tu estado antes de intentar de nuevo.",
    total: "Puntos totales",
    rank: "Posición",
    attempts: "Intentos disponibles hoy",
    playSnake: "Jugar Snake",
    playFlappy: "Jugar Flappy Bird",
    recent: "Intentos recientes",
    score: "Puntaje",
    rules: "Reglas de esta ronda",
    utc: "Los límites diarios se reinician a las 00:00 UTC.",
    three: "Recibes tres intentos oficiales por juego cada día UTC.",
    reserve: "El intento se reserva al comenzar. Recargar o salir lo anula.",
    expiry:
      "Cada intento vence después de 15 minutos o cuando cierra la ronda.",
    guest: "Los puntajes anteriores de invitado o práctica no cuentan.",
    scoring:
      "Los puntos usan los niveles publicados abajo; un puntaje entre niveles recibe el nivel inferior.",
    game: "Juego",
    rawScore: "Puntaje del juego",
    roundPoints: "Puntos de ronda",
    home: "Volver a los juegos",
  },
} as const;

async function fetchChampionship(): Promise<LoadState> {
  try {
    const publicResponse = await fetch("/api/competition", {
      cache: "no-store",
    });
    if (!publicResponse.ok) return { kind: "unavailable" };
    const publicState = (await publicResponse.json()) as PublicState;
    if (!publicState.round) return { kind: "ready", publicState, member: null };
    const memberResponse = await fetch(
      `/api/competition/me?roundId=${encodeURIComponent(publicState.round.id)}`,
      { cache: "no-store", credentials: "same-origin" },
    );
    if (memberResponse.status === 401)
      return { kind: "ready", publicState, member: null };
    if (!memberResponse.ok) return { kind: "unavailable" };
    return {
      kind: "ready",
      publicState,
      member: (await memberResponse.json()) as MemberState,
    };
  } catch {
    return { kind: "unavailable" };
  }
}

export function ChampionshipPanel() {
  const text = translations[getLocale()];
  const locale = getLocale() === "es-419" ? "es-419" : "en";
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [accepted, setAccepted] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void fetchChampionship().then((next) => current && setState(next));
    return () => {
      current = false;
    };
  }, []);

  async function reload() {
    setState(await fetchChampionship());
  }

  async function enroll(event: FormEvent<HTMLFormElement>, round: Round) {
    event.preventDefault();
    if (!accepted) return;
    setEnrolling(true);
    setMessage(null);
    try {
      const response = await fetch("/api/competition/enroll", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundId: round.id,
          acceptedRulesDigest: round.rulesDigest,
        }),
      });
      const body = (await response.json()) as {
        enrolled?: boolean;
        code?: string;
      };
      if (response.ok && body.enrolled === true) {
        await reload();
        return;
      }
      setAccepted(false);
      setMessage(
        body.code === "rules_changed"
          ? text.rulesChanged
          : text.enrollmentFailed,
      );
    } catch {
      setMessage(text.enrollmentFailed);
    } finally {
      setEnrolling(false);
    }
  }

  const round = state.kind === "ready" ? state.publicState.round : null;
  const member = state.kind === "ready" ? state.member : null;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <AegyoLogo className={styles.logo} />
        <p className={styles.eyebrow}>{text.eyebrow}</p>
        <h1>{text.title}</h1>
        <p className={styles.intro}>{text.intro}</p>
      </header>

      {state.kind === "loading" && (
        <section className={styles.notice}>{text.loading}</section>
      )}
      {state.kind === "unavailable" && (
        <section className={styles.notice}>
          <p>{text.unavailable}</p>
          <button
            className="btn-ghost"
            type="button"
            onClick={() => void reload()}
          >
            {text.retry}
          </button>
        </section>
      )}
      {state.kind === "ready" && !round && (
        <section className={styles.notice}>{text.noRound}</section>
      )}
      {state.kind === "ready" && round && (
        <>
          <section className={styles.roundCard}>
            <div className={styles.roundHeading}>
              <div>
                {round.mode === "synthetic" && (
                  <p className={styles.testBadge}>{text.test}</p>
                )}
                <h2>{round.slug.replaceAll("-", " ")}</h2>
              </div>
              <p className={styles.date}>
                {text.closes}{" "}
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "UTC",
                }).format(new Date(round.closesAt))}{" "}
                UTC
              </p>
            </div>
            {state.publicState.provisional && (
              <p className={styles.provisional}>{text.provisional}</p>
            )}
          </section>

          <section className={styles.card}>
            <h2>{text.yourRound}</h2>
            {!member ? (
              <div className={styles.actionBlock}>
                <p>{text.signedOut}</p>
                <Link className="btn-arcade" href="/account">
                  {text.account}
                </Link>
              </div>
            ) : !member.username || !member.emailVerified ? (
              <div className={styles.actionBlock}>
                <p>{text.setup}</p>
                <Link className="btn-arcade" href="/account">
                  {text.account}
                </Link>
              </div>
            ) : member.enrolled ? (
              <MemberRound member={member} round={round} text={text} />
            ) : (
              <form
                className={styles.enroll}
                onSubmit={(event) => void enroll(event, round)}
              >
                <h3>{text.notEnrolled}</h3>
                <label className={styles.checkbox}>
                  <input
                    type="checkbox"
                    checked={accepted}
                    onChange={(event) => setAccepted(event.target.checked)}
                  />
                  <span>{text.accept}</span>
                </label>
                {message && <p className={styles.error}>{message}</p>}
                <button
                  className="btn-arcade"
                  type="submit"
                  disabled={!accepted || enrolling}
                >
                  {enrolling ? text.enrolling : text.enroll}
                </button>
              </form>
            )}
          </section>

          <Rules round={round} text={text} />
          <Standings
            standings={state.publicState.standings ?? []}
            text={text}
          />
        </>
      )}
      <Link className={styles.home} href="/">
        ← {text.home}
      </Link>
    </main>
  );
}

function MemberRound({
  member,
  round,
  text,
}: {
  member: MemberState;
  round: Round;
  text: (typeof translations)["en"] | (typeof translations)["es-419"];
}) {
  return (
    <div className={styles.member}>
      <p className={styles.enrolled}>✓ {text.enrolled}</p>
      <div className={styles.stats}>
        <div>
          <span>{text.total}</span>
          <strong>{member.totalPoints}</strong>
        </div>
        <div>
          <span>{text.rank}</span>
          <strong>{member.rank ? `#${member.rank}` : "—"}</strong>
        </div>
      </div>
      <h3>{text.attempts}</h3>
      <div className={styles.gameActions}>
        <Link
          className="btn-arcade"
          href={`/play/snake?championship=${encodeURIComponent(round.id)}`}
        >
          {text.playSnake} · {member.remaining.snake}
        </Link>
        <Link
          className="btn-arcade"
          href={`/play/flappy?championship=${encodeURIComponent(round.id)}`}
        >
          {text.playFlappy} · {member.remaining.flappy}
        </Link>
      </div>
      {member.attempts.length > 0 && (
        <div className={styles.recent}>
          <h3>{text.recent}</h3>
          <ul>
            {member.attempts.map((attempt) => (
              <li key={attempt.id}>
                <span>
                  {attempt.gameId} · {attempt.dayKey}
                </span>
                <span>
                  {text.score}: {attempt.score ?? "—"} · {attempt.points ?? 0}{" "}
                  {text.points.toLowerCase()}
                </span>
                <small>{attempt.status}</small>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Rules({
  round,
  text,
}: {
  round: Round;
  text: (typeof translations)["en"] | (typeof translations)["es-419"];
}) {
  return (
    <section className={styles.card} id="round-rules">
      <h2>{text.rules}</h2>
      <ul className={styles.rules}>
        <li>{text.three}</li>
        <li>{text.utc}</li>
        <li>{text.reserve}</li>
        <li>{text.expiry}</li>
        <li>{text.guest}</li>
        <li>{text.scoring}</li>
      </ul>
      <div className={styles.calibrations}>
        {round.rules.games.map((game) => (
          <table key={game.gameId}>
            <caption>
              {game.gameId === "snake" ? "Snake" : "Flappy Bird"}
            </caption>
            <thead>
              <tr>
                <th scope="col">{text.rawScore}</th>
                <th scope="col">{text.roundPoints}</th>
              </tr>
            </thead>
            <tbody>
              {game.calibration.map((step) => (
                <tr key={step.score}>
                  <td>{step.score}</td>
                  <td>{step.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
    </section>
  );
}

function Standings({
  standings,
  text,
}: {
  standings: Standing[];
  text: (typeof translations)["en"] | (typeof translations)["es-419"];
}) {
  return (
    <section className={styles.card}>
      <h2>{text.standings}</h2>
      {standings.length === 0 ? (
        <p className={styles.empty}>{text.empty}</p>
      ) : (
        <div className={styles.tableScroll}>
          <table>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">{text.player}</th>
                <th scope="col">{text.points}</th>
                <th scope="col">{text.bestDay}</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row) => (
                <tr key={`${row.rank}-${row.username}`}>
                  <td>{row.rank}</td>
                  <th scope="row">@{row.username}</th>
                  <td>{row.totalPoints}</td>
                  <td>{row.maxDailyPoints}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
