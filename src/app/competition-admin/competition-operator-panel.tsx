"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./operator.module.css";

type Round = {
  id: string;
  slug: string;
  status: string;
  mode: string;
  rulesVersion: number;
  winnerCount: number | null;
  launchBlockers: string[];
  opensAt: string;
  closesAt: string;
  enrollmentCount: number;
  attemptCount: number;
  pendingCount: number;
  hasCandidateSnapshot: boolean;
  isFinal: boolean;
};
type Standing = {
  memberId: string;
  username: string | null;
  totalPoints: number;
  maxUtcDailyPoints: number;
  topTierResults: number;
  reachedFinalTotalAt: string;
  provisionalRank: number;
  exactTieKey: string | null;
  requiresReview: boolean;
};
type TieDecision = {
  exactTieKey: string;
  resolution: "shared_rank";
  memberIds: string[];
  rationale: string;
};
type Attempt = {
  id: string;
  gameId: string;
  status: string;
  securityConfirmed: boolean;
  score: number | null;
  points: number | null;
  receivedAt: string | null;
  rejectionCode: string | null;
  username: string | null;
};
type Award = {
  id: string;
  memberId: string;
  rank: number;
  awardKey: string;
  status: string;
  claimedAt: string | null;
  fulfilledAt: string | null;
  username: string | null;
};
type Dashboard = {
  serverNow: string;
  rounds: Round[];
  selected: null | {
    round: Round;
    pending: {
      attemptId: string;
      status: string;
      securityConfirmed: boolean;
      receiptDigest: string;
      receivedAt: string;
    }[];
    pendingNextCursor: { receivedAt: string; id: string } | null;
    candidate: null | {
      snapshotId: string;
      sourceDigest: string;
      standings: Standing[];
    };
    tieDecisions: TieDecision[];
    attempts: Attempt[];
    awards: Award[];
    audit: {
      id: string;
      operation: string;
      actor: string;
      createdAt: string;
    }[];
  };
};
type Allocation = {
  memberId: string;
  awardKey: string;
  allocationRationale: string;
};

const label = (value: string) => value.replaceAll("_", " ");
const readinessLabel: Record<string, string> = {
  public_rules_url: "Publish the final HTTPS rules URL",
  sponsor: "Name the sponsor",
  named_operator: "Name the responsible operator",
  approval_authority: "Record the final approving authority",
  eligibility_geography_age: "Approve geography and age eligibility",
  prize_allocation: "Approve prizes by rank",
  claim_deadline_fulfillment:
    "Approve the claim deadline and fulfillment terms",
  game_point_tables: "Approve the frozen score-to-points tables",
  full_arena_bonus: "Approve the configured Full Arena bonus",
  schedule: "Approve the complete schedule and time zone",
  exact_tie_policy: "Approve exact-tie and prize-boundary handling",
  engagement_sources: "Approve engagement sources, caps, and verification",
};
const displayTime = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "—";
const idempotencyKey = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function CompetitionOperatorPanel() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selectedRoundId, setSelectedRoundId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tieRationales, setTieRationales] = useState<Record<string, string>>(
    {},
  );
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const operationKeys = useRef(new Map<string, string>());

  const load = useCallback(
    async (
      roundId?: string,
      pendingCursor?: { receivedAt: string; id: string },
      appendPending = false,
    ) => {
      setLoading(true);
      setError(null);
      try {
        const query = new URLSearchParams();
        if (roundId) query.set("roundId", roundId);
        if (pendingCursor) {
          query.set("pendingAfterAt", pendingCursor.receivedAt);
          query.set("pendingAfterId", pendingCursor.id);
        }
        const suffix = query.size ? `?${query}` : "";
        const response = await fetch(`/api/competition/operator${suffix}`, {
          cache: "no-store",
        });
        const body = (await response.json()) as Dashboard & { code?: string };
        if (!response.ok) throw new Error(body.code ?? "operator_load_failed");
        setDashboard((current) => {
          if (
            !appendPending ||
            !current?.selected ||
            !body.selected ||
            current.selected.round.id !== body.selected.round.id
          )
            return body;
          const attempts = new Map(
            current.selected.attempts.map((attempt) => [attempt.id, attempt]),
          );
          for (const attempt of body.selected.attempts)
            attempts.set(attempt.id, attempt);
          const pending = new Map(
            current.selected.pending.map((attempt) => [
              attempt.attemptId,
              attempt,
            ]),
          );
          for (const attempt of body.selected.pending)
            pending.set(attempt.attemptId, attempt);
          return {
            ...body,
            selected: {
              ...body.selected,
              attempts: [...attempts.values()],
              pending: [...pending.values()],
            },
          };
        });
        setSelectedRoundId(body.selected?.round.id);
        if (!appendPending) {
          setTieRationales(
            Object.fromEntries(
              (body.selected?.tieDecisions ?? []).map((decision) => [
                decision.exactTieKey,
                decision.rationale,
              ]),
            ),
          );
          setAllocations([]);
        }
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "operator_load_failed",
        );
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/competition/operator", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as Dashboard & { code?: string };
        if (!response.ok) throw new Error(body.code ?? "operator_load_failed");
        if (cancelled) return;
        setDashboard(body);
        setSelectedRoundId(body.selected?.round.id);
        setTieRationales(
          Object.fromEntries(
            (body.selected?.tieDecisions ?? []).map((decision) => [
              decision.exactTieKey,
              decision.rationale,
            ]),
          ),
        );
      })
      .catch((caught: unknown) => {
        if (!cancelled)
          setError(
            caught instanceof Error ? caught.message : "operator_load_failed",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const act = useCallback(
    async (key: string, body: Record<string, unknown>, success: string) => {
      const requestKey = operationKeys.current.get(key) ?? idempotencyKey();
      operationKeys.current.set(key, requestKey);
      setBusy(key);
      setError(null);
      setNotice(null);
      try {
        const response = await fetch("/api/competition/operator/actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, idempotencyKey: requestKey }),
        });
        const result = (await response.json()) as { code?: string };
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500)
            operationKeys.current.delete(key);
          throw new Error(result.code ?? "operation_failed");
        }
        operationKeys.current.delete(key);
        setNotice(success);
        await load(selectedRoundId);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "operation_failed");
      } finally {
        setBusy(null);
      }
    },
    [load, selectedRoundId],
  );

  const selected = dashboard?.selected;
  const unresolvedTies = selected?.tieDecisions ?? [];
  const materialMonthly =
    selected?.round.mode === "material_prize" &&
    selected.round.rulesVersion === 2;
  const winnerCount = selected?.round.winnerCount ?? 0;
  const expectedWinners =
    selected?.candidate?.standings.filter(
      (standing) => standing.provisionalRank <= winnerCount,
    ) ?? [];
  const requiredAwardCount = Math.min(
    winnerCount,
    selected?.candidate?.standings.length ?? 0,
  );
  const awardedMembers = new Set(
    allocations.map((allocation) => allocation.memberId),
  );
  const prizeTiePending =
    materialMonthly &&
    expectedWinners.some((standing) => standing.exactTieKey !== null);
  const allocationReady =
    !materialMonthly ||
    (!prizeTiePending &&
      expectedWinners.length === requiredAwardCount &&
      allocations.length === requiredAwardCount &&
      awardedMembers.size === requiredAwardCount &&
      expectedWinners.every((standing) =>
        awardedMembers.has(standing.memberId),
      ) &&
      allocations.every(
        (allocation) =>
          allocation.awardKey.trim() && allocation.allocationRationale.trim(),
      ));
  const canFinalize =
    !!selected?.candidate &&
    selected.round.status === "review" &&
    selected.round.pendingCount === 0 &&
    unresolvedTies.every((tie) => tieRationales[tie.exactTieKey]?.trim()) &&
    allocationReady;
  const canOpen = (selected?.round.launchBlockers.length ?? 0) === 0;
  const serverNow = Date.parse(
    dashboard?.serverNow ?? "1970-01-01T00:00:00.000Z",
  );
  const canClose = selected
    ? ["open", "closing"].includes(selected.round.status) &&
      serverNow >= Date.parse(selected.round.closesAt)
    : false;
  const canDisqualify = selected
    ? ["open", "closing"].includes(selected.round.status) &&
      !selected.round.hasCandidateSnapshot
    : false;
  const candidateOptions = useMemo(
    () => selected?.candidate?.standings ?? [],
    [selected?.candidate?.standings],
  );

  function chooseRound(roundId: string) {
    operationKeys.current.clear();
    setSelectedRoundId(roundId);
    void load(roundId);
  }

  function addAllocation() {
    const first = candidateOptions[0];
    if (!first) return;
    setAllocations((current) => [
      ...current,
      {
        memberId: first.memberId,
        awardKey: `rank-${first.provisionalRank}`,
        allocationRationale: `Published rank ${first.provisionalRank}`,
      },
    ]);
  }

  if (loading && !dashboard)
    return (
      <main className={styles.page}>
        <p className={styles.loading}>Loading competition operations…</p>
      </main>
    );

  if (error && !dashboard) {
    const signedOut = error === "sign_in_required";
    return (
      <main className={styles.page}>
        <section className={styles.accessCard}>
          <p className={styles.eyebrow}>Competition operations</p>
          <h1>
            {signedOut ? "Sign in required" : "Operator access unavailable"}
          </h1>
          <p>
            {signedOut
              ? "Use an approved Aegyo Accounts identity to continue."
              : label(error)}
          </p>
          {signedOut ? <Link href="/account">Open my account</Link> : null}
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Private operator surface</p>
          <h1>Competition control room</h1>
          <p className={styles.intro}>
            Review evidence, lock results, assign awards and record fulfillment.
            Every mutation is written to the audit trail.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Link href="/championship">Public view</Link>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={loading || busy !== null}
            onClick={() => {
              operationKeys.current.clear();
              void load(selectedRoundId);
            }}
          >
            Refresh
          </button>
        </div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.roundRail} aria-label="Competition rounds">
          <div className={styles.railHeading}>
            <span>Rounds</span>
            <span>{dashboard?.rounds.length ?? 0}</span>
          </div>
          {dashboard?.rounds.length ? (
            dashboard.rounds.map((round) => (
              <button
                key={round.id}
                type="button"
                className={
                  round.id === selectedRoundId ? styles.activeRound : ""
                }
                aria-pressed={round.id === selectedRoundId}
                onClick={() => chooseRound(round.id)}
              >
                <strong>{round.slug}</strong>
                <span>{label(round.status)}</span>
                <small>{displayTime(round.opensAt)}</small>
              </button>
            ))
          ) : (
            <p className={styles.empty}>No rounds have been created.</p>
          )}
        </aside>

        <div className={styles.workspace}>
          {notice ? (
            <p className={styles.success} role="status">
              {notice}
            </p>
          ) : null}
          {error ? (
            <p className={styles.error} role="alert">
              {label(error)}
            </p>
          ) : null}

          {selected ? (
            <>
              <section className={styles.roundHeader}>
                <div>
                  <div className={styles.badges}>
                    <span data-status={selected.round.status}>
                      {label(selected.round.status)}
                    </span>
                    <span>{label(selected.round.mode)}</span>
                  </div>
                  <h2>{selected.round.slug}</h2>
                  <p>
                    {displayTime(selected.round.opensAt)} →{" "}
                    {displayTime(selected.round.closesAt)}
                  </p>
                </div>
                <div className={styles.lifecycleActions}>
                  {selected.round.status === "draft" ? (
                    <button
                      type="button"
                      disabled={busy !== null || !canOpen}
                      title={
                        canOpen
                          ? undefined
                          : "Resolve every launch-readiness item before opening"
                      }
                      onClick={() => {
                        if (
                          !window.confirm(
                            "Open this frozen round for enrollment and official attempts?",
                          )
                        )
                          return;
                        void act(
                          "open",
                          {
                            action: "open",
                            roundId: selected.round.id,
                            confirmation: `open:${selected.round.id}`,
                          },
                          "Round opened.",
                        );
                      }}
                    >
                      Open round
                    </button>
                  ) : null}
                  {["open", "closing"].includes(selected.round.status) &&
                  !selected.round.hasCandidateSnapshot ? (
                    <button
                      type="button"
                      disabled={!canClose || busy !== null}
                      title={
                        canClose
                          ? undefined
                          : "Available after the published close time"
                      }
                      onClick={() => {
                        if (
                          !window.confirm(
                            "Close official play and create the immutable candidate snapshot once all pending receipts are resolved?",
                          )
                        )
                          return;
                        void act(
                          "close",
                          {
                            action: "close",
                            roundId: selected.round.id,
                            confirmation: `close:${selected.round.id}`,
                          },
                          "Closure check completed.",
                        );
                      }}
                    >
                      {selected.round.status === "closing"
                        ? "Retry snapshot"
                        : "Close and snapshot"}
                    </button>
                  ) : null}
                </div>
              </section>

              {selected.round.mode === "material_prize" ? (
                <section
                  className={styles.card}
                  aria-label="Material launch readiness"
                >
                  <div className={styles.sectionHeading}>
                    <div>
                      <p className={styles.kicker}>Material launch gate</p>
                      <h3>
                        {canOpen
                          ? "Published terms are complete"
                          : "This contest cannot open"}
                      </h3>
                    </div>
                    <span>{selected.round.launchBlockers.length}</span>
                  </div>
                  {selected.round.launchBlockers.length ? (
                    <ul>
                      {selected.round.launchBlockers.map((blocker) => (
                        <li key={blocker}>
                          {readinessLabel[blocker] ?? label(blocker)}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.empty}>
                      All public business terms have resolved values. The
                      operator must still review the frozen schedule and rules
                      before opening.
                    </p>
                  )}
                </section>
              ) : null}

              <section className={styles.metrics} aria-label="Round summary">
                <article>
                  <span>Players</span>
                  <strong>{selected.round.enrollmentCount}</strong>
                </article>
                <article>
                  <span>Attempts</span>
                  <strong>{selected.round.attemptCount}</strong>
                </article>
                <article data-alert={selected.round.pendingCount > 0}>
                  <span>Pending review</span>
                  <strong>{selected.round.pendingCount}</strong>
                </article>
                <article>
                  <span>Result state</span>
                  <strong>
                    {selected.round.isFinal
                      ? "Final"
                      : selected.round.hasCandidateSnapshot
                        ? "Snapshot"
                        : "Live"}
                  </strong>
                </article>
              </section>

              <section className={styles.card}>
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.kicker}>Evidence queue</p>
                    <h3>Verified and reviewed attempts</h3>
                  </div>
                  <span>{selected.attempts.length}</span>
                </div>
                {selected.attempts.length ? (
                  <div className={styles.attemptList}>
                    {selected.attempts.map((attempt) => (
                      <article key={attempt.id}>
                        <div>
                          <strong>@{attempt.username ?? "unavailable"}</strong>
                          <span>
                            {attempt.gameId} · {label(attempt.status)} ·{" "}
                            {displayTime(attempt.receivedAt)}
                          </span>
                          {attempt.rejectionCode ? (
                            <small>{label(attempt.rejectionCode)}</small>
                          ) : null}
                        </div>
                        {attempt.status === "pending" ? (
                          <div className={styles.rowActions}>
                            {attempt.securityConfirmed ? (
                              <button
                                type="button"
                                disabled={busy !== null}
                                onClick={() =>
                                  void act(
                                    `settle:${attempt.id}`,
                                    {
                                      action: "settle",
                                      roundId: selected.round.id,
                                      attemptId: attempt.id,
                                      confirmation: `settle:${attempt.id}`,
                                    },
                                    "Attempt replayed.",
                                  )
                                }
                              >
                                Replay
                              </button>
                            ) : null}
                            <button
                              type="button"
                              className={styles.dangerButton}
                              disabled={busy !== null}
                              onClick={() => {
                                const reason = window.prompt(
                                  "Reason recorded in the audit trail",
                                );
                                if (!reason?.trim()) return;
                                void act(
                                  `reject:${attempt.id}`,
                                  {
                                    action: "reject_pending",
                                    roundId: selected.round.id,
                                    attemptId: attempt.id,
                                    reason,
                                    confirmation: `reject:${attempt.id}`,
                                  },
                                  "Pending attempt rejected.",
                                );
                              }}
                            >
                              Reject
                            </button>
                          </div>
                        ) : null}
                        {attempt.status === "verified" && canDisqualify ? (
                          <button
                            type="button"
                            className={styles.dangerButton}
                            disabled={busy !== null}
                            onClick={() => {
                              const reason = window.prompt(
                                "Published disqualification reason recorded in the audit trail",
                              );
                              if (!reason?.trim()) return;
                              if (
                                !window.confirm(
                                  selected.round.rulesVersion === 2
                                    ? "Disqualify this verified attempt and recompute the player’s weekly best and Full Arena bonus?"
                                    : "Disqualify this verified attempt and recompute the player’s daily best?",
                                )
                              )
                                return;
                              void act(
                                `disqualify:${attempt.id}`,
                                {
                                  action: "disqualify",
                                  roundId: selected.round.id,
                                  attemptId: attempt.id,
                                  reason,
                                  confirmation: `disqualify:${attempt.id}`,
                                },
                                "Attempt disqualified and standings recomputed.",
                              );
                            }}
                          >
                            Disqualify
                          </button>
                        ) : null}
                      </article>
                    ))}
                    {selected.pendingNextCursor ? (
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={loading || busy !== null}
                        onClick={() =>
                          void load(
                            selected.round.id,
                            selected.pendingNextCursor ?? undefined,
                            true,
                          )
                        }
                      >
                        Load older pending attempts
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className={styles.empty}>
                    No verified or reviewed attempts are available.
                  </p>
                )}
              </section>

              {selected.candidate ? (
                <section className={styles.card}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <p className={styles.kicker}>
                        Immutable candidate snapshot
                      </p>
                      <h3>Standings and award allocation</h3>
                    </div>
                    <span>{selected.candidate.standings.length}</span>
                  </div>
                  <div className={styles.tableWrap}>
                    <table>
                      <thead>
                        <tr>
                          <th>Rank</th>
                          <th>Player</th>
                          <th>Points</th>
                          <th>Top tiers</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.candidate.standings.map((standing) => (
                          <tr key={standing.memberId}>
                            <td>#{standing.provisionalRank}</td>
                            <td>@{standing.username ?? "unavailable"}</td>
                            <td>{standing.totalPoints}</td>
                            <td>{standing.topTierResults}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {unresolvedTies.map((tie) => (
                    <label className={styles.field} key={tie.exactTieKey}>
                      <span>Shared-rank rationale</span>
                      <textarea
                        value={tieRationales[tie.exactTieKey] ?? ""}
                        maxLength={1000}
                        placeholder="Explain how the published exact tie is handled."
                        onChange={(event) =>
                          setTieRationales((current) => ({
                            ...current,
                            [tie.exactTieKey]: event.target.value,
                          }))
                        }
                      />
                    </label>
                  ))}

                  <div className={styles.allocations}>
                    <div className={styles.allocationHeading}>
                      <h4>Awards</h4>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={!candidateOptions.length}
                        onClick={addAllocation}
                      >
                        Add award
                      </button>
                    </div>
                    {allocations.map((allocation, index) => (
                      <div className={styles.allocationRow} key={index}>
                        <select
                          aria-label={`Award ${index + 1} recipient`}
                          value={allocation.memberId}
                          onChange={(event) =>
                            setAllocations((current) =>
                              current.map((item, cursor) =>
                                cursor === index
                                  ? { ...item, memberId: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        >
                          {candidateOptions.map((standing) => (
                            <option
                              key={standing.memberId}
                              value={standing.memberId}
                            >
                              #{standing.provisionalRank} @
                              {standing.username ?? "unavailable"}
                            </option>
                          ))}
                        </select>
                        <input
                          aria-label={`Award ${index + 1} key`}
                          value={allocation.awardKey}
                          maxLength={80}
                          placeholder="Award key"
                          onChange={(event) =>
                            setAllocations((current) =>
                              current.map((item, cursor) =>
                                cursor === index
                                  ? { ...item, awardKey: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                        <input
                          aria-label={`Award ${index + 1} rationale`}
                          value={allocation.allocationRationale}
                          maxLength={1000}
                          placeholder="Allocation rationale"
                          onChange={(event) =>
                            setAllocations((current) =>
                              current.map((item, cursor) =>
                                cursor === index
                                  ? {
                                      ...item,
                                      allocationRationale: event.target.value,
                                    }
                                  : item,
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          className={styles.iconButton}
                          aria-label={`Remove award ${index + 1}`}
                          onClick={() =>
                            setAllocations((current) =>
                              current.filter((_, cursor) => cursor !== index),
                            )
                          }
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    {!allocations.length ? (
                      <p className={styles.empty}>
                        {materialMonthly
                          ? requiredAwardCount > 0
                            ? `Assign one award to each of the ${requiredAwardCount} eligible winner${requiredAwardCount === 1 ? "" : "s"} before finalizing.`
                            : "No eligible finisher earned positive points; no award will be created."
                          : "No awards assigned. Finalizing publishes standings without an award."}
                      </p>
                    ) : null}
                    {prizeTiePending ? (
                      <p className={styles.error} role="alert">
                        A prize position has an exact tie. Finalization remains
                        blocked until the published allocation policy is
                        implemented.
                      </p>
                    ) : null}
                  </div>

                  {selected.round.status === "review" ? (
                    <div className={styles.finalizeBar}>
                      <p>
                        Finalization permanently locks the standings and creates
                        the award offers shown above.
                      </p>
                      <button
                        type="button"
                        disabled={!canFinalize || busy !== null}
                        onClick={() => {
                          if (
                            !window.confirm(
                              "Publish these final standings and award allocations? This cannot be edited afterward.",
                            )
                          )
                            return;
                          void act(
                            "finalize",
                            {
                              action: "finalize",
                              roundId: selected.round.id,
                              confirmation: `finalize:${selected.round.id}`,
                              tieDecisions: selected.tieDecisions.map(
                                (tie) => ({
                                  ...tie,
                                  rationale:
                                    tieRationales[tie.exactTieKey] ?? "",
                                }),
                              ),
                              awards: allocations,
                            },
                            "Final standings published.",
                          );
                        }}
                      >
                        Finalize standings
                      </button>
                    </div>
                  ) : null}
                </section>
              ) : null}

              {selected.awards.length ? (
                <section className={styles.card}>
                  <div className={styles.sectionHeading}>
                    <div>
                      <p className={styles.kicker}>Prize fulfillment</p>
                      <h3>Winner claims</h3>
                    </div>
                    <span>{selected.awards.length}</span>
                  </div>
                  <div className={styles.awardList}>
                    {selected.awards.map((award) => (
                      <article key={award.id}>
                        <div>
                          <strong>
                            #{award.rank} @{award.username ?? "unavailable"}
                          </strong>
                          <span>
                            {award.awardKey} · {label(award.status)}
                          </span>
                          {award.claimedAt ? (
                            <small>
                              Claimed {displayTime(award.claimedAt)}
                            </small>
                          ) : null}
                        </div>
                        {award.status === "claimed" ? (
                          <button
                            type="button"
                            disabled={busy !== null}
                            onClick={() => {
                              const fulfillmentKey = window.prompt(
                                "Unique fulfillment reference",
                              );
                              if (!fulfillmentKey?.trim()) return;
                              const reason = window.prompt(
                                "Fulfillment note for the audit trail",
                                "Prize delivered to verified claimant",
                              );
                              if (!reason?.trim()) return;
                              void act(
                                `fulfill:${award.id}`,
                                {
                                  action: "fulfill",
                                  awardId: award.id,
                                  fulfillmentKey,
                                  reason,
                                  confirmation: `fulfill:${award.id}`,
                                },
                                "Prize marked fulfilled.",
                              );
                            }}
                          >
                            Record fulfillment
                          </button>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </section>
              ) : null}

              <section className={styles.card}>
                <div className={styles.sectionHeading}>
                  <div>
                    <p className={styles.kicker}>Append-only history</p>
                    <h3>Audit trail</h3>
                  </div>
                  <span>{selected.audit.length}</span>
                </div>
                {selected.audit.length ? (
                  <ol className={styles.auditList}>
                    {selected.audit.map((entry) => (
                      <li key={entry.id}>
                        <strong>{label(entry.operation)}</strong>
                        <span>{displayTime(entry.createdAt)}</span>
                        <small>{entry.actor}</small>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={styles.empty}>
                    No operator mutations recorded.
                  </p>
                )}
              </section>
            </>
          ) : (
            <section className={styles.card}>
              <h2>Rules pending</h2>
              <p className={styles.empty}>
                Create the first draft only after the schedule, prize and
                scoring decisions are approved.
              </p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
