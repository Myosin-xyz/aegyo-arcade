import { describe, expect, it } from "vitest";
import {
  BEAT_MS,
  GOOD_MS,
  MAX_NOTES,
  MAX_SCORE,
  OK_MS,
  PERFECT_MS,
  SONG_BEATS,
  accuracyOf,
  buildChart,
  createFanchantState,
  gradeForAccuracy,
  stepFanchant,
  tapFanchantLane,
} from "@/games/fanchant-hero/logic";
import { seededRandom } from "@/shell/rng";

describe("Fanchant Hero rules", () => {
  it("generates a deterministic, bounded chart from the run seed", () => {
    const a = buildChart(seededRandom("chart"));
    const b = buildChart(seededRandom("chart"));
    const c = buildChart(seededRandom("other-chart"));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(MAX_NOTES);
    expect(a.every((note) => note.lane >= 0 && note.lane < 4)).toBe(true);
  });

  it("applies PERFECT, GOOD, and OK windows with the combo bonus", () => {
    const playAtDelta = (delta: number) => {
      const state = createFanchantState(seededRandom(`window-${delta}`));
      const note = state.notes[0];
      state.elapsedMs = note.beat * BEAT_MS + delta;
      return { state, hit: tapFanchantLane(state, note.lane) };
    };
    expect(playAtDelta(PERFECT_MS).hit).toMatchObject({
      judgement: "perfect",
      points: 102,
    });
    expect(playAtDelta(PERFECT_MS + 1).hit).toMatchObject({
      judgement: "good",
      points: 62,
    });
    expect(playAtDelta(GOOD_MS + 1).hit).toMatchObject({
      judgement: "ok",
      points: 32,
    });
    expect(playAtDelta(OK_MS + 1).hit).toBeNull();
  });

  it("marks late notes missed, resets combo, and calculates final accuracy/grade", () => {
    const state = createFanchantState(seededRandom("misses"));
    const first = state.notes[0];
    state.elapsedMs = first.beat * BEAT_MS;
    expect(tapFanchantLane(state, first.lane)).not.toBeNull();
    expect(state.combo).toBe(1);

    const second = state.notes.find((note) => note.status === "pending")!;
    state.elapsedMs = second.beat * BEAT_MS + OK_MS;
    const event = stepFanchant(state, 1);
    expect(event.missed).toBeGreaterThanOrEqual(1);
    expect(state.combo).toBe(0);
    expect(accuracyOf(state)).toBeLessThan(100);
    expect(gradeForAccuracy(100)).toBe("S");
    expect(gradeForAccuracy(88)).toBe("A");
    expect(gradeForAccuracy(60)).toBe("C");
    expect(gradeForAccuracy(0)).toBe("D");
  });

  it("ends after the 120-beat song and has an exact 115-note score cap", () => {
    const state = createFanchantState(seededRandom("ending"));
    state.elapsedMs = (SONG_BEATS + 2) * BEAT_MS;
    expect(stepFanchant(state, 1).ended).toBe(true);
    expect(state.status).toBe("over");
    expect(MAX_SCORE).toBe(24_840);
  });
});
