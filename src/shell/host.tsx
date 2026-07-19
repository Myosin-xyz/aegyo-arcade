"use client";

/**
 * <GameHost/> — the single React⇄game boundary (TECH_SPEC §5, §6.3).
 *
 * Owns the lifecycle state machine:
 *   created → initializing → ready → running ↔ paused → ended
 * with `ended → running` on restart, `failed` on init/asset error, and
 * `destroyed` terminal from every state (including mid-init via abort).
 *
 * The host exposes `data-lifecycle` and `data-score` for conformance
 * spikes and E2E tests.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  GameSurface,
  LifecycleState,
  RunContext,
} from "./contract";
import { canStart } from "./contract";
import type { RegistryEntry } from "@/games/registry";
import { FixedLoop } from "./loop";
import { CanvasSurfaceManager } from "./surface";
import { createInputBus } from "./input";
import { createAudioBus } from "./audio";
import { practiceSeed, seededRandom } from "./rng";
import { bootstrapSession } from "./session";
import { t } from "@/i18n/t";
import { getRegistryEntry } from "@/games/registry";

/** Counted-run UI state (M2): issuance → active → submit → receipt. */
type CountedPhase =
  | { kind: "idle" }
  | { kind: "issuing" }
  | { kind: "active"; attemptId: string }
  | { kind: "submitting" }
  | {
      kind: "submitted";
      rank: number;
      seasonKey: string;
      streak: { current: number; best: number };
      score: number;
    }
  | { kind: "owned-complete"; streak: { current: number; best: number } | null }
  | { kind: "blocked"; nextEligibleAt: string }
  | { kind: "error"; retryable: boolean };

interface Mounted {
  instance: GameInstance;
  surfaceManager: CanvasSurfaceManager | null;
  input: ReturnType<typeof createInputBus>;
  audio: ReturnType<typeof createAudioBus>;
  loop: FixedLoop | null;
  runAbort: AbortController | null;
  endedThisRun: boolean;
}

export function GameHost({ gameId }: { gameId: string }) {
  return <GameHostInner entry={getRegistryEntry(gameId)} gameId={gameId} />;
}

/**
 * Inner host, entry-injectable so host-level conformance tests can drive the
 * REAL component with fixtures (M0 review P1: the production host — not just
 * the test driver — must enforce the lifecycle state machine).
 */
export function GameHostInner({
  entry,
  gameId,
}: {
  entry: RegistryEntry | undefined;
  gameId: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef<Mounted | null>(null);
  const initAbortRef = useRef<AbortController | null>(null);
  // Authoritative synchronous lifecycle: React state alone can't reject a
  // second click in the same task, so every transition goes through the ref.
  const lifecycleRef = useRef<LifecycleState>("created");
  const [lifecycle, setLifecycle] = useState<LifecycleState>("created");
  const [score, setScore] = useState(0);
  const [muted, setMuted] = useState(false);
  const [initNonce, setInitNonce] = useState(0);
  const [counted, setCounted] = useState<CountedPhase>({ kind: "idle" });
  const countedAttemptRef = useRef<string | null>(null);
  const scoreRef = useRef(0);
  const runStartedAtRef = useRef(0);
  // Immutable until a valid receipt arrives — the same-page idempotent
  // retry token (§10.1; M2 review P1).
  const pendingSubmissionRef = useRef<{
    attemptId: string;
    score: number;
    clientDurationMs: number;
  } | null>(null);
  // Synchronous issuance guard (same-task double activation, M2 review P2).
  const issuingRef = useRef(false);

  const transition = useCallback((next: LifecycleState) => {
    lifecycleRef.current = next;
    setLifecycle(next);
  }, []);

  const teardown = useCallback(() => {
    initAbortRef.current?.abort();
    initAbortRef.current = null;
    const mounted = mountedRef.current;
    if (!mounted) return;
    mountedRef.current = null;
    mounted.runAbort?.abort();
    mounted.loop?.stop();
    try {
      mounted.instance.destroy();
    } catch {
      // destroy() is contractually idempotent/safe; never break unmount.
    }
    mounted.input.destroy();
    mounted.audio.destroy();
    mounted.surfaceManager?.destroy();
  }, []);

  // Attempt the pending submission. The pending payload is IMMUTABLE and
  // survives failures so "Retry save" re-sends the identical attempt id +
  // score + duration — the server replays idempotently (§9.2/§10.1).
  const attemptCountedSubmit = useCallback(async () => {
    const pending = pendingSubmissionRef.current;
    if (!pending) return;
    setCounted({ kind: "submitting" });
    try {
      const res = await fetch(`/api/runs/${pending.attemptId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          score: pending.score,
          clientDurationMs: pending.clientDurationMs,
        }),
      });
      // Stale-response guard: only the CURRENT pending token may apply.
      if (pendingSubmissionRef.current !== pending) return;
      if (!res.ok) {
        setCounted({ kind: "error", retryable: true });
        return;
      }
      const body = (await res.json()) as {
        rank: number;
        seasonKey: string;
        streak: { current: number; best: number };
        score: number;
      };
      pendingSubmissionRef.current = null;
      setCounted({
        kind: "submitted",
        rank: body.rank,
        seasonKey: body.seasonKey,
        streak: body.streak,
        score: body.score,
      });
    } catch {
      if (pendingSubmissionRef.current === pending) {
        setCounted({ kind: "error", retryable: true });
      }
    }
  }, []);

  // report.end path for generic-submit games: freeze the pending payload,
  // then attempt it.
  const submitCountedIfNeeded = useCallback(async () => {
    const attemptId = countedAttemptRef.current;
    if (!attemptId) return;
    countedAttemptRef.current = null;
    pendingSubmissionRef.current = {
      attemptId,
      score: scoreRef.current,
      clientDurationMs: Math.round(performance.now() - runStartedAtRef.current),
    };
    await attemptCountedSubmit();
  }, [attemptCountedSubmit]);

  // report.end path for game-owned games (claw): the attempt was consumed
  // by the game's own committed server action — no PUT. Show the streak.
  const finishOwnedCounted = useCallback(async () => {
    if (!countedAttemptRef.current) return;
    countedAttemptRef.current = null;
    try {
      const res = await fetch("/api/streak");
      const streak = res.ok
        ? ((await res.json()) as { current: number; best: number })
        : null;
      setCounted({ kind: "owned-complete", streak });
    } catch {
      setCounted({ kind: "owned-complete", streak: null });
    }
  }, []);

  // Mount → init. Re-runs only on retry (initNonce).
  useEffect(() => {
    if (!entry) return;
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const abort = new AbortController();
    initAbortRef.current = abort;
    transition("initializing");
    setScore(0);

    (async () => {
      const definition: GameDefinition = await entry.load();
      if (cancelled) return;

      // Build the surface the metadata declares — before game code runs.
      container.replaceChildren();
      let surface: GameSurface;
      let surfaceManager: CanvasSurfaceManager | null = null;
      let inputTarget: HTMLElement;
      if (entry.meta.surface === "canvas") {
        const canvas = document.createElement("canvas");
        canvas.style.touchAction = "none";
        canvas.setAttribute("data-testid", "game-surface");
        canvas.setAttribute("role", "application");
        canvas.setAttribute(
          "aria-label",
          `${t(entry.meta.titleKey)} \u2014 ${t(`game.${gameId}.controls`)}`,
        );
        container.appendChild(canvas);
        // Module-loop legacy games (claw) own their canvas sizing/DPR;
        // undefined means shell-managed (the norm — ADR 0005).
        if (entry.hostManagedCanvas !== false) {
          surfaceManager = new CanvasSurfaceManager(
            canvas,
            container,
            entry.meta.designBox,
          );
        }
        const context2d = canvas.getContext("2d");
        if (!context2d) throw new Error("canvas-2d-unavailable");
        surface = {
          kind: "canvas",
          canvas,
          context2d,
          designBox: entry.meta.designBox,
        };
        inputTarget = canvas;
      } else {
        const root = document.createElement("div");
        root.style.width = "100%";
        root.style.height = "100%";
        root.setAttribute("data-testid", "game-surface");
        root.setAttribute(
          "aria-label",
          `${t(entry.meta.titleKey)} \u2014 ${t(`game.${gameId}.controls`)}`,
        );
        container.appendChild(root);
        surface = { kind: "dom", root };
        inputTarget = root;
      }

      const input = createInputBus({
        target: inputTarget,
        // Dom surfaces must NOT capture: it retargets click events away
        // from real buttons (hangman e2e regression).
        capturePointer: entry.meta.surface === "canvas",
        toDesign: (x, y) =>
          surfaceManager
            ? surfaceManager.toDesign(x, y)
            : relativeToHost(inputTarget, x, y),
      });
      const audio = createAudioBus();
      setMuted(audio.muted);

      const ctx: GameContext = {
        host: container,
        surface,
        input,
        audio,
        t,
        report: {
          score: (value) => {
            if (!Number.isFinite(value) || value < 0) return;
            scoreRef.current = Math.floor(value);
            setScore(Math.floor(value));
          },
          end: (result) => {
            const mounted = mountedRef.current;
            if (!mounted || mounted.endedThisRun) return;
            mounted.endedThisRun = true;
            mounted.loop?.stop();
            mounted.runAbort?.abort();
            transition("ended");
            if (entry.countedCompletion === "game-owned") {
              // A refusal-end ("quit") must NOT render the saved receipt
              // — only a genuinely completed drop does (M4 review P2).
              if (result?.reason === "completed") void finishOwnedCounted();
            } else {
              void submitCountedIfNeeded();
            }
          },
        },
      };

      const instance = definition.create(ctx);
      const loop =
        instance.loop === "shell"
          ? new FixedLoop({
              update: (dt) => instance.update(dt),
              render: (alpha) => instance.render(alpha),
            })
          : null;

      mountedRef.current = {
        instance,
        surfaceManager,
        input,
        audio,
        loop,
        runAbort: null,
        endedThisRun: false,
      };

      try {
        await instance.init(abort.signal);
      } catch (error) {
        if (!cancelled) {
          console.error(`[host] init failed for ${gameId}`, error);
          // Tear the failed instance + services down NOW — the retry path
          // rebuilds everything from scratch (M0 review edge).
          teardown();
          transition("failed");
        }
        return;
      }
      if (cancelled) return;
      transition("ready");
    })().catch((error) => {
      if (!cancelled) {
        console.error(`[host] load failed for ${gameId}`, error);
        transition("failed");
      }
    });

    return () => {
      cancelled = true;
      teardown();
      transition("destroyed");
    };
  }, [
    entry,
    gameId,
    initNonce,
    teardown,
    transition,
    submitCountedIfNeeded,
    finishOwnedCounted,
  ]);

  const startRun = useCallback(() => {
    const mounted = mountedRef.current;
    // §6.3: start only from ready/ended — enforced HERE, in the production
    // host, not just the conformance driver (M0 review P1). The ref rejects
    // a second synchronous click before React re-renders the overlay away.
    if (!mounted || !canStart(lifecycleRef.current)) return;
    // A previous run's signal must not survive into the new run.
    mounted.runAbort?.abort();
    // Practice-only in M0/M1; counted slots arrive with the meta-layer (M2).
    // ?seed= pins the practice seed (deterministic e2e/repro hook —
    // practice seeds are arbitrary and practice never submits, so this
    // has no competitive surface; counted seeds stay server-issued).
    const seedOverride = new URLSearchParams(window.location.search).get(
      "seed",
    );
    const seed = seedOverride || practiceSeed();
    const runAbort = new AbortController();
    const run: RunContext = {
      mode: "practice",
      attemptId: null,
      seed,
      random: seededRandom(seed),
      signal: runAbort.signal,
    };
    mounted.runAbort = runAbort;
    mounted.endedThisRun = false;
    setScore(0);
    scoreRef.current = 0;
    runStartedAtRef.current = performance.now();
    countedAttemptRef.current = null; // practice never submits
    setCounted((c) =>
      c.kind === "blocked" || (c.kind === "error" && c.retryable)
        ? c
        : { kind: "idle" },
    );
    try {
      mounted.instance.start(run);
    } catch (error) {
      // A game rejecting the run context (e.g. malformed non-practice run)
      // fails closed into the error state — never a half-started run.
      console.error("[host] start rejected", error);
      teardown();
      transition("failed");
      return;
    }
    // start() may end the run SYNCHRONOUSLY (report.end sets endedThisRun);
    // in that case the run is already over — never start the loop or
    // overwrite "ended" with "running" (M0 review edge).
    if (mounted.endedThisRun) return;
    mounted.loop?.start();
    transition("running");
  }, [teardown, transition]);

  /** Issue today's counted attempt, then run with its server seed (§9.2). */
  const startCountedRun = useCallback(async () => {
    if (!canStart(lifecycleRef.current)) return;
    if (issuingRef.current) return; // same-task double activation (P2)
    issuingRef.current = true;
    setCounted({ kind: "issuing" });
    try {
      await bootstrapSession();
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId }),
      });
      if (res.status === 409) {
        const body = (await res.json()) as { nextEligibleAt?: string };
        setCounted({
          kind: "blocked",
          nextEligibleAt: body.nextEligibleAt ?? "",
        });
        return;
      }
      if (!res.ok) {
        setCounted({ kind: "error", retryable: false });
        return;
      }
      const issued = (await res.json()) as { attemptId: string; seed: string };

      // Re-check after the awaits — the player may have started practice.
      const mounted = mountedRef.current;
      if (!mounted || !canStart(lifecycleRef.current)) {
        setCounted({ kind: "idle" });
        return;
      }
      mounted.runAbort?.abort();
      const runAbort = new AbortController();
      const run: RunContext = {
        mode: "counted",
        attemptId: issued.attemptId,
        seed: issued.seed,
        random: seededRandom(issued.seed),
        signal: runAbort.signal,
      };
      mounted.runAbort = runAbort;
      mounted.endedThisRun = false;
      setScore(0);
      scoreRef.current = 0;
      // Refs BEFORE start(): a synchronously-ending game must still find
      // the attempt id when report.end fires the submission.
      countedAttemptRef.current = issued.attemptId;
      runStartedAtRef.current = performance.now();
      setCounted({ kind: "active", attemptId: issued.attemptId });
      try {
        mounted.instance.start(run);
      } catch (error) {
        console.error("[host] counted start rejected", error);
        countedAttemptRef.current = null;
        setCounted({ kind: "error", retryable: false });
        teardown();
        transition("failed");
        return;
      }
      // Synchronous end: submission already fired; leave its state alone.
      if (mounted.endedThisRun) return;
      mounted.loop?.start();
      transition("running");
    } catch {
      setCounted({ kind: "error", retryable: false });
    } finally {
      issuingRef.current = false;
    }
  }, [gameId, teardown, transition]);

  const pauseRun = useCallback(
    (reason: "hidden" | "blur" | "system") => {
      const mounted = mountedRef.current;
      if (!mounted || lifecycleRef.current !== "running") return;
      mounted.loop?.stop();
      // Pause determinism (M2 slice-B review P1): frozen time must mean
      // frozen state — no pointer/keyboard event may reach the game while
      // the pause overlay is up.
      mounted.input.setEnabled(false);
      mounted.instance.pause(reason);
      transition("paused");
    },
    [transition],
  );

  const resumeRun = useCallback(() => {
    const mounted = mountedRef.current;
    if (!mounted || lifecycleRef.current !== "paused") return;
    mounted.input.setEnabled(true);
    mounted.instance.resume();
    mounted.loop?.start();
    transition("running");
  }, [transition]);

  // Auto-pause when the tab hides or the window blurs (TECH_SPEC §6.3).
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") pauseRun("hidden");
    };
    const onBlur = () => pauseRun("blur");
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
    };
  }, [pauseRun]);

  const toggleMute = useCallback(() => {
    const mounted = mountedRef.current;
    if (!mounted) return;
    mounted.audio.setMuted(!mounted.audio.muted);
    setMuted(mounted.audio.muted);
  }, []);

  const countedCapable = entry !== undefined && entry.meta.capabilities.counted;

  if (!entry) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
        <p className="text-muted">{t("host.unknownGame")}</p>
        <Link className="btn-ghost px-5 py-2 text-sm font-semibold" href="/">
          {t("host.back")}
        </Link>
      </div>
    );
  }

  return (
    <div
      className="mx-auto flex min-h-dvh w-full max-w-md flex-col"
      data-testid="game-host"
      data-lifecycle={lifecycle}
      data-score={score}
    >
      <header className="flex items-center justify-between gap-2 border-b border-line bg-surface/70 px-3 py-2 backdrop-blur">
        <Link
          className="shrink-0 px-1 text-xl font-bold leading-none text-brand"
          href="/"
          aria-label={t("host.back")}
        >
          {"\u2039"}
        </Link>
        <span className="min-w-0 truncate font-arcade text-[11px] font-bold">
          {t(entry.meta.titleKey)}
        </span>
        <div className="flex shrink-0 items-center gap-3">
          {(entry.scorePresentation ?? "shell") === "shell" && (
            <span
              className="text-sm font-semibold tabular-nums text-gold"
              aria-label={t("host.score")}
            >
              {score}
            </span>
          )}
          <button
            type="button"
            className="px-1 text-sm font-semibold text-muted"
            onClick={toggleMute}
            aria-label={muted ? t("host.unmute") : t("host.mute")}
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M4 9h4l5-4v14l-5-4H4z" />
              {muted ? (
                <path
                  d="M16.5 9.5 21 14m0-4.5L16.5 14"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M16 8.5a5 5 0 0 1 0 7"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </div>
      </header>

      <p className="sr-only" aria-live="polite">
        {lifecycle === "ended" &&
        (entry.scorePresentation ?? "shell") !== "none"
          ? `${t("host.score")}: ${score}`
          : ""}
      </p>

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} className="absolute inset-0" />

        {lifecycle === "initializing" && (
          <Overlay>
            <p className="font-arcade text-sm text-muted">
              {t("host.loading")}
            </p>
          </Overlay>
        )}
        {lifecycle === "failed" && (
          <Overlay>
            <p className="text-muted">{t("host.loadFailed")}</p>
            <button
              type="button"
              className="btn-ghost px-5 py-2 font-semibold"
              onClick={() => setInitNonce((n) => n + 1)}
              data-testid="retry-init"
            >
              {t("host.retry")}
            </button>
          </Overlay>
        )}
        {lifecycle === "ready" && (
          <Overlay>
            <p className="max-w-[17rem] text-center text-sm text-white/80">
              {t(`game.${gameId}.controls`)}
            </p>
            {countedCapable && (
              <>
                <button
                  type="button"
                  className="btn-arcade px-8 py-4 text-lg"
                  onClick={() => void startCountedRun()}
                  disabled={counted.kind === "issuing"}
                  data-testid="start-counted"
                >
                  {counted.kind === "issuing"
                    ? t("host.countedIssuing")
                    : t("host.todaysRun")}
                </button>
                {counted.kind === "blocked" && (
                  <p className="max-w-xs text-center text-sm">
                    {t("host.countedBlocked", {
                      time: formatEligibleTime(counted.nextEligibleAt),
                    })}
                  </p>
                )}
                {counted.kind === "error" && (
                  <p className="max-w-xs text-center text-sm">
                    {t("host.countedUnavailable")}
                  </p>
                )}
              </>
            )}
            <button
              type="button"
              className="btn-ghost px-7 py-3 text-lg font-semibold"
              onClick={startRun}
              data-testid="start-run"
            >
              {countedCapable ? t("host.practice") : t("host.start")}
            </button>
          </Overlay>
        )}
        {lifecycle === "paused" && (
          <Overlay>
            <p className="font-arcade text-sm">{t("host.paused")}</p>
            <button
              type="button"
              className="btn-arcade px-8 py-3 text-lg"
              onClick={resumeRun}
              data-testid="resume-run"
            >
              {t("host.resume")}
            </button>
          </Overlay>
        )}
        {lifecycle === "ended" && entry.endPresentation === "game-authored" && (
          // The game's own in-DOM result stays visible (M4.5 review P1):
          // no dark overlay — just the host-owned restart (fresh
          // RunContext through the normal startRun path).
          <div className="absolute inset-x-0 bottom-0 z-10 flex justify-center p-4">
            <button
              type="button"
              className="btn-arcade px-8 py-3 text-lg"
              onClick={startRun}
              data-testid="play-again"
            >
              {t("host.playAgain")}
            </button>
          </div>
        )}
        {lifecycle === "ended" && entry.endPresentation !== "game-authored" && (
          <Overlay>
            {(entry.scorePresentation ?? "shell") !== "none" && (
              // A "none" game has NO score concept — a fictional
              // "Score: 0" may not appear anywhere, visible or
              // accessible (M4.5 review P2, enum-complete).
              <p
                className="font-arcade text-xl text-gold"
                data-testid="ended-score"
              >
                {t("host.score")}: {score}
              </p>
            )}
            {counted.kind === "submitting" && (
              <p className="text-sm">{t("host.submitting")}</p>
            )}
            {counted.kind === "submitted" && (
              <div
                className="flex flex-col items-center gap-1 text-sm"
                data-testid="counted-result"
              >
                <p>{t("host.submittedRank", { rank: counted.rank })}</p>
                <p>
                  {t("host.streakLine", {
                    current: counted.streak.current,
                    best: counted.streak.best,
                  })}
                </p>
                <Link
                  className="font-semibold text-accent underline underline-offset-4"
                  href={`/leaderboard/${gameId}`}
                >
                  {t("host.viewBoard")}
                </Link>
              </div>
            )}
            {counted.kind === "owned-complete" && (
              <div
                className="flex flex-col items-center gap-1 text-sm"
                data-testid="counted-result"
              >
                <p>{t("host.ownedSaved")}</p>
                {counted.streak && (
                  <p>
                    {t("host.streakLine", {
                      current: counted.streak.current,
                      best: counted.streak.best,
                    })}
                  </p>
                )}
              </div>
            )}
            {counted.kind === "error" && (
              <div className="flex flex-col items-center gap-2 text-sm">
                <p>{t("host.submitError")}</p>
                {counted.retryable && (
                  <button
                    type="button"
                    className="btn-arcade px-5 py-2.5 text-sm"
                    onClick={() => void attemptCountedSubmit()}
                    data-testid="retry-save"
                  >
                    {t("host.retrySave")}
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              className="btn-arcade px-8 py-3 text-lg"
              onClick={startRun}
              disabled={counted.kind === "submitting"}
              data-testid="play-again"
            >
              {t("host.playAgain")}
            </button>
          </Overlay>
        )}
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-[rgba(12,5,28,0.78)] text-white backdrop-blur-[2px]">
      {children}
    </div>
  );
}

function formatEligibleTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function relativeToHost(
  target: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = target.getBoundingClientRect();
  return { x: clientX - rect.left, y: clientY - rect.top };
}
