import { describe, expect, it } from "vitest";
import {
  createNoCapState,
  DESIGN_H,
  RUN_TICKS,
  stepNoCap,
  swipeNoCap,
  type FlyingItem,
} from "@/games/no-cap/logic";
import { CompetitionTraceCaptureV4 } from "@/competition/replay-v4";
import { verifyCompetitionTrace } from "@/competition/verify-replay";
import { seededRandom } from "@/shell/rng";

function item(
  id: number,
  fake: boolean,
  rarity: "normal" | "silver" | "gold" = "normal",
): FlyingItem {
  return {
    id,
    x: 180,
    y: 320,
    vx: 0,
    vy: 0,
    rot: 0,
    rotSpeed: 0,
    fake,
    gold: rarity === "gold",
    silver: rarity === "silver",
    key: "ticket",
    sliced: false,
    missed: false,
  };
}

describe("NO CAP deterministic rules", () => {
  it("scores rarities and combos while real merch costs at most 20 points", () => {
    const state = createNoCapState();
    state.items = [
      item(1, true),
      item(2, true, "silver"),
      item(3, true, "gold"),
    ];
    expect(swipeNoCap(state, "down", 150, 320).accepted).toBe(true);
    const hit = swipeNoCap(state, "move", 210, 320);
    expect(hit.hits.map((entry) => entry.points)).toEqual([15, 50, 150]);
    expect(state.score).toBe(215);
    state.items = [item(4, false)];
    swipeNoCap(state, "move", 150, 320);
    expect(state.score).toBe(195);
    expect(state.combo).toBe(0);
    expect(state.bestScore).toBe(215);
  });

  it("replays a real seeded 90-second swipe run and rejects manipulated input", () => {
    const seed = "no-cap-official-proof";
    const rng = seededRandom(seed);
    const state = createNoCapState();
    const capture = new CompetitionTraceCaptureV4(seed);
    let swipes = 0;
    for (let tick = 0; tick < RUN_TICKS; tick++) {
      const target = state.items.find(
        (entry) => entry.fake && entry.y > 100 && entry.y < DESIGN_H - 100,
      );
      if (target && swipes < 5) {
        const y = Math.round(target.y);
        const left = Math.max(0, Math.round(target.x - 25));
        const right = Math.min(360, Math.round(target.x + 25));
        for (const [action, x] of [
          ["down", left],
          ["move", right],
          ["up", right],
        ] as const) {
          const accepted = swipeNoCap(state, action, x, y);
          expect(accepted.accepted).toBe(true);
          capture.record(action, x, y);
        }
        swipes++;
      }
      stepNoCap(state, rng);
      capture.advanceTick();
    }
    expect(swipes).toBeGreaterThan(0);
    expect(state.status).toBe("over");
    const trace = capture.finish();
    expect(verifyCompetitionTrace(trace)).toMatchObject({
      ok: true,
      gameId: "no-cap",
      score: state.score,
      ticks: RUN_TICKS,
    });
    expect(
      verifyCompetitionTrace({
        ...trace,
        terminal: { ...trace.terminal, tick: 100 },
      }),
    ).toMatchObject({ ok: false });
    expect(
      verifyCompetitionTrace({ ...trace, events: [[0, 1, 180, 320]] }),
    ).toMatchObject({ ok: false, code: "action_not_accepted" });
  });
});
