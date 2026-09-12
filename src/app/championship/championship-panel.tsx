"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import type { PublicRoundRules } from "@/competition/rules";
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
  rules: PublicRoundRules;
  rulesDigest: string;
};
type PublicState = {
  round: Round | null;
  standings?: Standing[];
  provisional?: boolean;
  gameHighScores?: { gameId: string; username: string; score: number }[];
  serverNow?: string;
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
  awards?: { id: string; awardKey: string; status: string; rank: number }[];
};
type LoadState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | {
      kind: "ready";
      publicState: PublicState;
      member: MemberState | null;
      clockOffsetMs: number;
    };

type RoundPhase = "upcoming" | "open" | "review" | "final";

export function phaseAt(
  round: Pick<Round, "status" | "opensAt" | "closesAt">,
  nowMs: number,
): RoundPhase {
  if (round.status === "final") return "final";
  if (round.status === "review" || round.status === "closing") return "review";
  const opensAt = Date.parse(round.opensAt);
  const closesAt = Date.parse(round.closesAt);
  if (Number.isFinite(opensAt) && nowMs < opensAt) return "upcoming";
  if (round.status === "open" && Number.isFinite(closesAt) && nowMs < closesAt)
    return "open";
  return "review";
}

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
    opens: "Opens",
    upcoming: "Official enrollment and attempts open at the time shown above.",
    review: "This round is closed while results are reviewed.",
    final: "This round is final. Official attempts are closed.",
    practice: "Practice play stays available from Games.",
    provisional: "Standings are provisional while results are reviewed.",
    standings: "Standings",
    highScores: "Game high scores",
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
    awards: "Your awards",
    awardInstructions: "Claim instructions",
    acknowledge: "I’ve read and accept these claim instructions.",
    claim: "Record my claim",
    claiming: "Recording…",
    claimed: "Claim recorded",
    claimUnknown:
      "We couldn’t confirm the claim. Check its status before trying again.",
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
    opens: "Abre",
    upcoming:
      "La inscripción y los intentos oficiales abren a la hora indicada arriba.",
    review: "Esta ronda cerró mientras se revisan los resultados.",
    final: "Esta ronda terminó. Los intentos oficiales están cerrados.",
    practice: "Las partidas de práctica siguen disponibles en Juegos.",
    provisional: "La tabla es provisional mientras se revisan los resultados.",
    standings: "Clasificación",
    highScores: "Mejores puntajes por juego",
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
    awards: "Tus reconocimientos",
    awardInstructions: "Instrucciones para reclamar",
    acknowledge: "Leí y acepto estas instrucciones para reclamar.",
    claim: "Registrar mi solicitud",
    claiming: "Registrando…",
    claimed: "Solicitud registrada",
    claimUnknown:
      "No pudimos confirmar la solicitud. Revisa su estado antes de intentar de nuevo.",
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
    const parsedServerNow = Date.parse(publicState.serverNow ?? "");
    const clockOffsetMs = Number.isFinite(parsedServerNow)
      ? parsedServerNow - Date.now()
      : 0;
    if (!publicState.round)
      return { kind: "ready", publicState, member: null, clockOffsetMs };
    const memberResponse = await fetch(
      `/api/competition/me?roundId=${encodeURIComponent(publicState.round.id)}`,
      { cache: "no-store", credentials: "same-origin" },
    );
    if (memberResponse.status === 401)
      return { kind: "ready", publicState, member: null, clockOffsetMs };
    if (!memberResponse.ok) return { kind: "unavailable" };
    return {
      kind: "ready",
      publicState,
      member: (await memberResponse.json()) as MemberState,
      clockOffsetMs,
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
  const [clockTick, setClockTick] = useState(() => Date.now());

  useEffect(() => {
    let current = true;
    void fetchChampionship().then((next) => current && setState(next));
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick(Date.now()), 1_000);
    return () => window.clearInterval(timer);
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
  const phase =
    round && state.kind === "ready"
      ? phaseAt(round, clockTick + state.clockOffsetMs)
      : null;

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
                {phase === "upcoming" ? text.opens : text.closes}{" "}
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: "UTC",
                }).format(
                  new Date(
                    phase === "upcoming" ? round.opensAt : round.closesAt,
                  ),
                )}{" "}
                UTC
              </p>
            </div>
            {state.publicState.provisional && (
              <p className={styles.provisional}>{text.provisional}</p>
            )}
          </section>

          <section className={styles.card}>
            <h2>{text.yourRound}</h2>
            {phase !== "open" ? (
              <div className={styles.actionBlock}>
                <p>
                  {phase === "upcoming"
                    ? text.upcoming
                    : phase === "final"
                      ? text.final
                      : text.review}{" "}
                  {text.practice}
                </p>
                {member?.enrolled && (
                  <MemberRound
                    member={member}
                    round={round}
                    text={text}
                    canPlay={false}
                  />
                )}
              </div>
            ) : !member ? (
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
              <MemberRound member={member} round={round} text={text} canPlay />
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
          <GameHighScores
            scores={state.publicState.gameHighScores ?? []}
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
  canPlay,
}: {
  member: MemberState;
  round: Round;
  text: (typeof translations)["en"] | (typeof translations)["es-419"];
  canPlay: boolean;
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
      {canPlay && (
        <>
          <h3>{text.attempts}</h3>
          <div className={styles.gameActions}>
            {round.rules.games.map(({ gameId }) => (
              <Link
                className="btn-arcade"
                href={`/play/${gameId}?championship=${encodeURIComponent(round.id)}`}
                key={gameId}
              >
                {gameId === "snake" ? text.playSnake : text.playFlappy} ·{" "}
                {member.remaining[gameId]}
              </Link>
            ))}
          </div>
        </>
      )}
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
      {member.awards && member.awards.length > 0 && (
        <AwardClaims
          awards={member.awards}
          instructions={round.rules.approval?.claims}
          text={text}
        />
      )}
    </div>
  );
}

function AwardClaims({
  awards,
  instructions,
  text,
}: {
  awards: NonNullable<MemberState["awards"]>;
  instructions?: string;
  text: (typeof translations)["en"] | (typeof translations)["es-419"];
}) {
  const [accepted, setAccepted] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [keys] = useState(() => new Map<string, string>());
  async function claim(awardId: string) {
    const key = keys.get(awardId) ?? crypto.randomUUID();
    keys.set(awardId, key);
    setPending(awardId);
    try {
      const response = await fetch(
        `/api/competition/awards/${encodeURIComponent(awardId)}/claim`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            acceptedInstructions: true,
            idempotencyKey: key,
          }),
        },
      );
      const body = (await response.json()) as { status?: string };
      if (
        response.ok &&
        (body.status === "claimed" || body.status === "fulfilled")
      ) {
        setMessages((current) => ({ ...current, [awardId]: text.claimed }));
      } else {
        if (response.status < 500) keys.delete(awardId);
        setMessages((current) => ({
          ...current,
          [awardId]: text.claimUnknown,
        }));
      }
    } catch {
      setMessages((current) => ({ ...current, [awardId]: text.claimUnknown }));
    } finally {
      setPending(null);
    }
  }
  return (
    <section className={styles.awards}>
      <h3>{text.awards}</h3>
      {instructions && (
        <p>
          <strong>{text.awardInstructions}:</strong> {instructions}
        </p>
      )}
      {awards.map((award) => (
        <div className={styles.award} key={award.id}>
          <p>
            <strong>#{award.rank}</strong> · {award.awardKey}
          </p>
          {award.status === "offered" ? (
            <>
              <label className={styles.checkbox}>
                <input
                  type="checkbox"
                  checked={accepted[award.id] ?? false}
                  onChange={(event) =>
                    setAccepted((current) => ({
                      ...current,
                      [award.id]: event.target.checked,
                    }))
                  }
                />
                <span>{text.acknowledge}</span>
              </label>
              <button
                className="btn-arcade"
                type="button"
                disabled={!accepted[award.id] || pending === award.id}
                onClick={() => void claim(award.id)}
              >
                {pending === award.id ? text.claiming : text.claim}
              </button>
            </>
          ) : (
            <p className={styles.enrolled}>{text.claimed}</p>
          )}
          {messages[award.id] && (
            <p className={styles.error} role="status">
              {messages[award.id]}
            </p>
          )}
        </div>
      ))}
    </section>
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

function GameHighScores({
  scores,
  text,
}: {
  scores: NonNullable<PublicState["gameHighScores"]>;
  text: (typeof translations)["en"] | (typeof translations)["es-419"];
}) {
  if (scores.length === 0) return null;
  return (
    <section className={styles.card}>
      <h2>{text.highScores}</h2>
      <div className={styles.tableScroll}>
        <table>
          <thead>
            <tr>
              <th scope="col">{text.game}</th>
              <th scope="col">{text.player}</th>
              <th scope="col">{text.score}</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((row) => (
              <tr key={`${row.gameId}-${row.username}`}>
                <th scope="row">
                  {row.gameId === "snake" ? "Snake" : "Flappy Bird"}
                </th>
                <td>@{row.username}</td>
                <td>{row.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
