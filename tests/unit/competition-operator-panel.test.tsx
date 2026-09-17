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
          launchBlockers: ["prize_allocation", "exact_tie_policy"],
        },
      }),
    );
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("This contest cannot open"),
    );
    expect(container?.textContent).toContain("Approve prizes by rank");
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
});
