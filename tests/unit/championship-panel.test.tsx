import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChampionshipPanel } from "@/app/championship/championship-panel";

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

  async function renderPanel() {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root?.render(<ChampionshipPanel />));
  }

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
});
