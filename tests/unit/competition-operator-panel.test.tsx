import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompetitionOperatorPanel } from "@/app/competition-admin/competition-operator-panel";

const round = {
  id: "10000000-0000-4000-8000-000000000001",
  slug: "weekly-test",
  status: "closing",
  mode: "synthetic",
  rulesVersion: 1,
  winnerCount: null,
  launchBlockers: [],
  opensAt: "2026-09-14T04:00:00.000Z",
  closesAt: "2026-09-21T04:00:00.000Z",
  enrollmentCount: 2,
  attemptCount: 4,
  pendingCount: 0,
  hasCandidateSnapshot: false,
  isFinal: false,
};

function response(selected: Record<string, unknown>) {
  const selectedRound = { ...round, ...(selected.round as object) };
  return new Response(
    JSON.stringify({
      serverNow: "2026-09-21T04:00:01.000Z",
      rounds: [selectedRound],
      selected: {
        pending: [],
        attempts: [],
        awards: [],
        audit: [],
        tieDecisions: [],
        candidate: null,
        ...selected,
        round: selectedRound,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

describe("competition operator panel", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
    vi.unstubAllGlobals();
  });

  async function render(responseValue: Response) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseValue));
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<CompetitionOperatorPanel />));
  }

  it("keeps closure available while pending evidence is being resolved", async () => {
    await render(response({}));
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("Retry snapshot"),
    );
  });

  it("keeps a material draft closed while public terms are unresolved", async () => {
    await render(
      response({
        round: {
          status: "draft",
          mode: "material_prize",
          rulesVersion: 2,
          winnerCount: 3,
          launchBlockers: [
            "prize_allocation",
            "game_point_tables",
            "full_arena_bonus",
            "exact_tie_policy",
          ],
        },
      }),
    );
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("This contest cannot open"),
    );
    expect(container?.textContent).toContain("Approve prizes by rank");
    expect(container?.textContent).toContain(
      "Approve the frozen score-to-points tables",
    );
    expect(container?.textContent).toContain(
      "Approve the configured Full Arena bonus",
    );
    const button = [...(container?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent === "Open round",
    );
    expect(button?.disabled).toBe(true);
  });

  it("requires a written shared-rank rationale before finalization", async () => {
    const tieKey = "20:20:2026-09-21T03:00:00.000Z";
    await render(
      response({
        round: {
          status: "review",
          hasCandidateSnapshot: true,
        },
        candidate: {
          snapshotId: "20000000-0000-4000-8000-000000000001",
          sourceDigest: "a".repeat(64),
          standings: [
            {
              memberId: "30000000-0000-4000-8000-000000000001",
              username: "fan_one",
              totalPoints: 20,
              maxUtcDailyPoints: 20,
              topTierResults: 1,
              reachedFinalTotalAt: "2026-09-21T03:00:00.000Z",
              provisionalRank: 1,
              exactTieKey: tieKey,
              requiresReview: true,
            },
            {
              memberId: "40000000-0000-4000-8000-000000000001",
              username: "fan_two",
              totalPoints: 20,
              maxUtcDailyPoints: 20,
              topTierResults: 1,
              reachedFinalTotalAt: "2026-09-21T03:00:00.000Z",
              provisionalRank: 1,
              exactTieKey: tieKey,
              requiresReview: true,
            },
          ],
        },
        tieDecisions: [
          {
            exactTieKey: tieKey,
            resolution: "shared_rank",
            memberIds: [
              "30000000-0000-4000-8000-000000000001",
              "40000000-0000-4000-8000-000000000001",
            ],
            rationale: "",
          },
        ],
      }),
    );
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("Finalize standings"),
    );
    const button = [...(container?.querySelectorAll("button") ?? [])].find(
      (candidate) => candidate.textContent === "Finalize standings",
    );
    expect(button?.disabled).toBe(true);
    const textarea = container?.querySelector("textarea");
    await act(async () => {
      if (!textarea) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      setter?.call(textarea, "The published rules retain the shared rank.");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(button?.disabled).toBe(false);
  });

  it("requires a reason and confirmation before disqualifying a verified attempt", async () => {
    const attemptId = "50000000-0000-4000-8000-000000000001";
    const selected = {
      round: { status: "open" },
      attempts: [
        {
          id: attemptId,
          gameId: "snake",
          status: "verified",
          securityConfirmed: true,
          score: 80,
          points: 20,
          receivedAt: "2026-09-20T03:00:00.000Z",
          rejectionCode: null,
          username: "fan_one",
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(selected))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ repeated: false }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        response({ ...selected, attempts: [], round: { status: "open" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "prompt").mockReturnValue("published automation rule");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<CompetitionOperatorPanel />));
    const button = await vi.waitFor(() => {
      const candidate = [...(container?.querySelectorAll("button") ?? [])].find(
        (item) => item.textContent === "Disqualify",
      );
      expect(candidate).toBeTruthy();
      return candidate!;
    });
    await act(async () => button.click());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(window.prompt).toHaveBeenCalledWith(
      "Published disqualification reason recorded in the audit trail",
    );
    expect(window.confirm).toHaveBeenCalledWith(
      "Disqualify this verified attempt and recompute the player’s daily best?",
    );
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      action: "disqualify",
      roundId: round.id,
      attemptId,
      reason: "published automation rule",
      confirmation: `disqualify:${attemptId}`,
    });
  });

  it("reuses an action idempotency key after a lost response", async () => {
    const attemptId = "50000000-0000-4000-8000-000000000002";
    const selected = {
      round: { status: "open" },
      attempts: [
        {
          id: attemptId,
          gameId: "snake",
          status: "pending",
          securityConfirmed: true,
          score: null,
          points: null,
          receivedAt: "2026-09-20T03:00:00.000Z",
          rejectionCode: null,
          username: "fan_two",
        },
      ],
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(selected))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ repeated: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        response({ ...selected, attempts: [], round: { status: "open" } }),
      );
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<CompetitionOperatorPanel />));
    const replay = await vi.waitFor(() => {
      const candidate = [...(container?.querySelectorAll("button") ?? [])].find(
        (item) => item.textContent === "Replay",
      );
      expect(candidate).toBeTruthy();
      return candidate!;
    });
    await act(async () => replay.click());
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("response lost"),
    );
    await act(async () => replay.click());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const firstKey = JSON.parse(
      String(fetchMock.mock.calls[1][1]?.body),
    ).idempotencyKey;
    const retryKey = JSON.parse(
      String(fetchMock.mock.calls[2][1]?.body),
    ).idempotencyKey;
    expect(firstKey).toBeTruthy();
    expect(retryKey).toBe(firstKey);
  });

  it("loads older pending attempts with the stable server cursor", async () => {
    const firstAttempt = {
      id: "50000000-0000-4000-8000-000000000003",
      gameId: "snake",
      status: "pending",
      securityConfirmed: false,
      score: null,
      points: null,
      receivedAt: "2026-09-19T01:00:00.000Z",
      rejectionCode: null,
      username: "first_fan",
    };
    const secondAttempt = {
      ...firstAttempt,
      id: "50000000-0000-4000-8000-000000000004",
      receivedAt: "2026-09-19T02:00:00.000Z",
      username: "second_fan",
    };
    const cursor = {
      receivedAt: firstAttempt.receivedAt,
      id: firstAttempt.id,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({ attempts: [firstAttempt], pendingNextCursor: cursor }),
      )
      .mockResolvedValueOnce(
        response({ attempts: [secondAttempt], pendingNextCursor: null }),
      );
    vi.stubGlobal("fetch", fetchMock);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<CompetitionOperatorPanel />));
    const loadMore = await vi.waitFor(() => {
      const candidate = [...(container?.querySelectorAll("button") ?? [])].find(
        (item) => item.textContent === "Load older pending attempts",
      );
      expect(candidate).toBeTruthy();
      return candidate!;
    });
    await act(async () => loadMore.click());
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      `pendingAfterAt=${encodeURIComponent(cursor.receivedAt)}`,
    );
    expect(String(fetchMock.mock.calls[1][0])).toContain(
      `pendingAfterId=${cursor.id}`,
    );
    expect(container?.textContent).toContain("@first_fan");
    expect(container?.textContent).toContain("@second_fan");
  });
});
