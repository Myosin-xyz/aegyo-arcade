import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChampionshipPanel,
  phaseAt,
} from "@/app/championship/championship-panel";

const round = {
  id: "00000000-0000-0000-0000-000000000001",
  slug: "september-test",
  status: "open",
  opensAt: "2026-09-01T00:00:00.000Z",
  closesAt: "2026-10-01T00:00:00.000Z",
  mode: "synthetic",
  rulesDigest: "digest",
  rules: {
    version: 1,
    mode: "synthetic",
    dailyAttempts: 3,
    attemptTtlSeconds: 900,
    games: [
      {
        gameId: "snake",
        calibration: [
          { score: 0, points: 0 },
          { score: 100, points: 1000 },
        ],
      },
    ],
  },
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("championship journey", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = undefined;
    container?.remove();
    container = undefined;
    vi.unstubAllGlobals();
  });

  async function renderPanel(selectedRound?: string) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () =>
      root?.render(<ChampionshipPanel selectedRound={selectedRound} />),
    );
  }

  it("changes phase at the exact published interval boundaries", () => {
    const opens = Date.parse(round.opensAt);
    const closes = Date.parse(round.closesAt);
    expect(phaseAt(round, opens - 1)).toBe("upcoming");
    expect(phaseAt(round, opens)).toBe("open");
    expect(phaseAt(round, closes - 1)).toBe("open");
    expect(phaseAt(round, closes)).toBe("review");
    expect(phaseAt({ ...round, status: "final" }, opens)).toBe("final");
  });

  it("shows public synthetic rules without claiming a prize and sends signed-out players to account", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response({ round, standings: [], provisional: true }),
        )
        .mockResolvedValueOnce(response({ authenticated: false }, 401)),
    );
    await renderPanel();
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("Test round · no prizes"),
    );
    expect(container?.textContent).toContain(
      "Earlier guest or practice scores do not count.",
    );
    expect(container?.querySelector('a[href="/account"]')?.textContent).toBe(
      "Open my account",
    );
    expect(container?.textContent?.toLowerCase()).not.toContain("win a prize");
  });

  it("shows only official game links and remaining attempts to an enrolled member", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response({
            round,
            standings: [],
            provisional: false,
            gameHighScores: [
              { gameId: "snake", username: "fan_99", score: 42 },
            ],
          }),
        )
        .mockResolvedValueOnce(
          response({
            enrolled: true,
            username: "fan_99",
            emailVerified: true,
            attempts: [],
            remaining: { snake: 2, flappy: 0 },
            totalPoints: 450,
            rank: 3,
          }),
        ),
    );
    await renderPanel();
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("You’re enrolled"),
    );
    expect(
      container?.querySelector('a[href^="/play/snake?championship="]')
        ?.textContent,
    ).toContain("· 2");
    expect(
      container?.querySelector('a[href^="/play/flappy?championship="]'),
    ).toBeNull();
    expect(container?.textContent).toContain("#3");
    expect(container?.textContent).toContain("Game high scores");
    expect(container?.textContent).toContain("@fan_99");
    expect(container?.textContent).toContain("42");
  });

  it("does not expose enrollment or play when material terms are pending", async () => {
    const pendingMaterialRound = {
      ...round,
      mode: "material_prize" as const,
      rules: {
        ...round.rules,
        mode: "material_prize" as const,
        rulesUrl: "https://example.com/draft",
        approval: {
          sponsor: "Example Sponsor",
          operator: "Named Operator",
          eligibility: "[REQUIRED: geography and age]",
          prizes: "TBD",
          claims: "Pending",
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ round: pendingMaterialRound }))
        .mockResolvedValueOnce(
          response({
            enrolled: true,
            username: "fan_99",
            emailVerified: true,
            attempts: [],
            remaining: { snake: 3 },
            totalPoints: 0,
            rank: null,
          }),
        ),
    );
    await renderPanel();
    await vi.waitFor(() =>
      expect(container?.textContent).toContain(
        "Prize terms pending · enrollment closed",
      ),
    );
    expect(container?.textContent).toContain("No material contest is open");
    expect(container?.querySelector('a[href^="/play/"]')).toBeNull();
    expect(container?.querySelector('button[type="submit"]')).toBeNull();
  });

  it("explains weekly scoring and the dynamic Full Arena bonus for monthly rounds", async () => {
    const monthlyRound = {
      ...round,
      rules: {
        ...round.rules,
        version: 2,
        dailyAttempts: 2,
        cadence: "monthly",
        winnerCount: 3,
        scoring: {
          bestPerGame: "week",
          timeZone: "America/New_York",
          fullArenaBonusPoints: 25,
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response({
            round: monthlyRound,
            standings: [
              {
                username: "fan_99",
                rank: 1,
                totalPoints: 500,
                maxDailyPoints: 500,
                maxPeriodPoints: 500,
              },
            ],
          }),
        )
        .mockResolvedValueOnce(response({ authenticated: false }, 401)),
    );
    await renderPanel();
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("Only your best verified score"),
    );
    expect(container?.textContent).toContain("all 1 active game");
    expect(container?.textContent).toContain("25-point Full Arena bonus");
    expect(container?.textContent).toContain("top 3 players");
    expect(container?.textContent).toContain("Best week");
    expect(container?.textContent).toContain("America/New_York");
  });

  it("shows the opening time without enrollment before a scheduled round", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response({
            round: {
              ...round,
              opensAt: "2026-10-01T00:00:00.000Z",
              closesAt: "2026-11-01T00:00:00.000Z",
            },
            serverNow: "2026-09-20T00:00:00.000Z",
          }),
        )
        .mockResolvedValueOnce(response({ authenticated: false }, 401)),
    );
    await renderPanel();
    await vi.waitFor(() => expect(container?.textContent).toContain("Opens"));
    expect(container?.textContent).toContain(
      "Official enrollment and attempts open at the time shown above.",
    );
    expect(container?.querySelector('button[type="submit"]')).toBeNull();
    expect(container?.querySelector('a[href^="/play/"]')).toBeNull();
  });

  it("closes official play after the interval but keeps member results visible", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response({
            round,
            serverNow: "2026-10-02T00:00:00.000Z",
          }),
        )
        .mockResolvedValueOnce(
          response({
            enrolled: true,
            username: "fan_99",
            emailVerified: true,
            attempts: [],
            remaining: { snake: 2, flappy: 3 },
            totalPoints: 450,
            rank: 3,
          }),
        ),
    );
    await renderPanel();
    await vi.waitFor(() =>
      expect(container?.textContent).toContain(
        "This round is closed while results are reviewed.",
      ),
    );
    expect(container?.textContent).toContain("450");
    expect(container?.querySelector('a[href^="/play/"]')).toBeNull();
  });

  it("keeps an offered award claim available after finalization", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          response({
            round: {
              ...round,
              status: "final",
              mode: "material_prize",
              rules: {
                ...round.rules,
                mode: "material_prize",
                approval: { claims: "Confirm delivery details with the team." },
              },
            },
            serverNow: "2026-10-02T00:00:00.000Z",
          }),
        )
        .mockResolvedValueOnce(
          response({
            enrolled: true,
            username: "fan_99",
            emailVerified: true,
            attempts: [],
            remaining: { snake: 0, flappy: 0 },
            totalPoints: 1000,
            rank: 1,
            awards: [
              { id: "award-1", awardKey: "winner", status: "offered", rank: 1 },
            ],
          }),
        ),
    );
    await renderPanel();
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("This round is final."),
    );
    expect(container?.textContent).toContain(
      "Confirm delivery details with the team.",
    );
    expect(container?.querySelector('button[type="button"]')?.textContent).toBe(
      "Record my claim",
    );
    expect(container?.querySelector('a[href^="/play/"]')).toBeNull();
  });

  it("loads a selected past round and keeps other months navigable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          round: { ...round, status: "final" },
          serverNow: "2026-10-02T00:00:00.000Z",
          rounds: [
            {
              slug: "october-test",
              status: "open",
              opensAt: "2026-10-01T00:00:00.000Z",
              closesAt: "2026-11-01T00:00:00.000Z",
            },
            {
              slug: round.slug,
              status: "final",
              opensAt: round.opensAt,
              closesAt: round.closesAt,
            },
          ],
        }),
      )
      .mockResolvedValueOnce(response({ authenticated: false }, 401));
    vi.stubGlobal("fetch", fetchMock);
    await renderPanel(round.slug);
    await vi.waitFor(() =>
      expect(container?.textContent).toContain("Recent rounds"),
    );
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/competition?round=september-test",
    );
    expect(
      container?.querySelector('a[href="/championship?round=october-test"]')
        ?.textContent,
    ).toContain("October 2026");
    expect(
      container
        ?.querySelector('a[href="/championship?round=september-test"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");
  });
});
