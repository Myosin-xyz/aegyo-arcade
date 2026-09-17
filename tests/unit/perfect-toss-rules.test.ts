import { describe, expect, it } from "vitest";
import {
  BONUS_SCORE,
  PERFECT_FRAC,
  REACTION_TICKS,
  SCORE_GOOD,
  SCORE_PERFECT,
  SHRINK_ON_GOOD,
  SPEED_GROW,
  START_HALF_WIDTH,
  THROW_TICKS,
  ZONE_DRIFT_AFTER,
  attemptToss,
  bonusCenter,
  createPerfectTossState,
  markerPosition,
  stepPerfectToss,
} from "@/games/perfect-toss/logic";
import { seededRandom } from "@/shell/rng";

function noBonus(): number {
  return 0.9;
}

function centerMarker(state: ReturnType<typeof createPerfectTossState>): void {
  state.zoneCenter = markerPosition(state);
}

describe("Perfect Toss rules", () => {
  it("builds exactly the same opening from the same seed", () => {
    expect(createPerfectTossState(seededRandom("same"))).toEqual(
      createPerfectTossState(seededRandom("same")),
    );
    expect(createPerfectTossState(seededRandom("other"))).not.toEqual(
      createPerfectTossState(seededRandom("same")),
    );
  });

  it("scores PERFECT without shrinking and GOOD with the documented shrink", () => {
    const perfect = createPerfectTossState(noBonus);
    centerMarker(perfect);
    expect(attemptToss(perfect, noBonus)).toMatchObject({
      result: "perfect",
      points: SCORE_PERFECT,
      catches: 1,
    });
    expect(perfect.halfWidth).toBe(START_HALF_WIDTH);
    expect(perfect.speed).toBeCloseTo(SPEED_GROW);

    const good = createPerfectTossState(noBonus);
    good.zoneCenter =
      markerPosition(good) + good.halfWidth * PERFECT_FRAC + 0.001;
    expect(attemptToss(good, noBonus)).toMatchObject({
      result: "good",
      points: SCORE_GOOD,
      catches: 1,
    });
    expect(good.halfWidth).toBeCloseTo(START_HALF_WIDTH * SHRINK_ON_GOOD);
    expect(good.speed).toBeCloseTo(SPEED_GROW);
  });

  it("adds the green tick bonus on top of the normal result", () => {
    const state = createPerfectTossState(noBonus);
    centerMarker(state);
    state.bonusZone = { offset: 0, halfWidth: 0.02 };
    const event = attemptToss(state, noBonus);
    expect(event).toMatchObject({
      result: "perfect",
      bonusHit: true,
      points: SCORE_PERFECT + BONUS_SCORE,
    });
    expect(state.score).toBe(SCORE_PERFECT + BONUS_SCORE);
  });

  it("relocates after catch four and starts contained drift at catch nine", () => {
    const relocating = createPerfectTossState(noBonus);
    relocating.catches = 3;
    centerMarker(relocating);
    attemptToss(relocating, () => 0.8);
    expect(relocating.catches).toBe(4);
    expect(relocating.zoneCenter).not.toBe(0.5);

    const drifting = createPerfectTossState(noBonus);
    drifting.catches = ZONE_DRIFT_AFTER - 1;
    drifting.zonePhase = Math.PI / 2;
    centerMarker(drifting);
    const rolls = [0, 1]; // create a bonus at the far right of the zone
    attemptToss(drifting, () => rolls.shift() ?? 1);
    expect(drifting.catches).toBe(ZONE_DRIFT_AFTER);
    expect(drifting.zoneCenter + drifting.halfWidth).toBeLessThanOrEqual(1);
    expect(drifting.bonusZone).not.toBeNull();

    for (let tick = 0; tick < 600; tick += 1) {
      stepPerfectToss(drifting);
      const center = bonusCenter(drifting)!;
      expect(center - drifting.bonusZone!.halfWidth).toBeGreaterThanOrEqual(
        drifting.zoneCenter - drifting.halfWidth - Number.EPSILON,
      );
      expect(center + drifting.bonusZone!.halfWidth).toBeLessThanOrEqual(
        drifting.zoneCenter + drifting.halfWidth + Number.EPSILON,
      );
      expect(drifting.zoneCenter - drifting.halfWidth).toBeGreaterThanOrEqual(
        -Number.EPSILON,
      );
      expect(drifting.zoneCenter + drifting.halfWidth).toBeLessThanOrEqual(
        1 + Number.EPSILON,
      );
    }
  });

  it("blocks another input during the 33-tick flight", () => {
    const state = createPerfectTossState(noBonus);
    centerMarker(state);
    expect(attemptToss(state, noBonus)).not.toBeNull();
    expect(attemptToss(state, noBonus)).toBeNull();
    for (let tick = 0; tick < THROW_TICKS - 1; tick += 1) {
      expect(stepPerfectToss(state)).toBeNull();
    }
    expect(stepPerfectToss(state)).toMatchObject({
      kind: "landed",
      result: "perfect",
    });
    centerMarker(state);
    expect(attemptToss(state, noBonus)).not.toBeNull();
  });

  it("renders a full sad reaction before a miss becomes terminal", () => {
    const state = createPerfectTossState(noBonus);
    expect(attemptToss(state, noBonus)).toMatchObject({ result: "miss" });
    for (let tick = 0; tick < THROW_TICKS - 1; tick += 1) {
      stepPerfectToss(state);
    }
    expect(stepPerfectToss(state)).toMatchObject({
      kind: "landed",
      result: "miss",
    });
    expect(state.status).toBe("miss-reaction");
    expect(state.reaction).toMatchObject({
      result: "miss",
      ticksRemaining: REACTION_TICKS,
    });
    for (let tick = 0; tick < REACTION_TICKS - 1; tick += 1) {
      expect(stepPerfectToss(state)).toBeNull();
      expect(state.status).toBe("miss-reaction");
    }
    expect(stepPerfectToss(state)).toEqual({ kind: "ended", result: "miss" });
    expect(state.status).toBe("over");
  });
});
