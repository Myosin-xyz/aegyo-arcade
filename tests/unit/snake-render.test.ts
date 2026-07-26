/**
 * Snake Freebies presentation wiring. Rule tests own mechanics; this file
 * proves the production renderer actually carries DaiDai's synthwave/HUD/
 * toast layer instead of leaving the port as a plain arena.
 */

import { describe, expect, it } from "vitest";
import { createSnakeState } from "@/games/snake/logic";
import { renderSnake, type SnakeImages } from "@/games/snake/render";
import { seededRandom } from "@/shell/rng";

interface Recording {
  texts: { text: string; font: string; fillStyle: unknown }[];
  fills: unknown[];
  roundedRects: number;
}

function recordingContext(): {
  ctx: CanvasRenderingContext2D;
  recording: Recording;
} {
  const recording: Recording = { texts: [], fills: [], roundedRects: 0 };
  const state: Record<PropertyKey, unknown> = {
    font: "",
    fillStyle: "",
    globalAlpha: 1,
    fillRect() {
      recording.fills.push(state.fillStyle);
    },
    fillText(text: string) {
      recording.texts.push({
        text,
        font: String(state.font),
        fillStyle: state.fillStyle,
      });
    },
    roundRect() {
      recording.roundedRects++;
    },
  };
  const ctx = new Proxy(state, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return () => undefined;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, recording };
}

function stubImages(): SnakeImages {
  const image = { naturalWidth: 24, naturalHeight: 24 } as HTMLImageElement;
  return {
    head: image,
    gift: image,
    frame: image,
    freebies: Array.from({ length: 19 }, () => image),
  };
}

describe("snake render — DaiDai presentation parity", () => {
  it("wires the synthwave backdrop, two-row HUD, arcade font and toast", () => {
    const state = createSnakeState(seededRandom("snake-render"));
    const { ctx, recording } = recordingContext();
    const copy: Record<string, string> = {
      "game.snake.hud.level": "Level",
      "game.snake.hud.score": "Score",
      "game.snake.hud.time": "Time",
      "game.snake.hud.lives": "Lives",
      "game.snake.hud.freebies": "Freebies",
    };

    renderSnake(ctx, state, stubImages(), (key) => copy[key] ?? key, 500, {
      toast: "Nice catch!",
      toastOpacity: 1,
      arcadeFont: '"ArcadeTest", monospace',
    });

    expect(recording.fills).toEqual(
      expect.arrayContaining(["#05010f", "#17002f", "#4a1070"]),
    );
    expect(recording.roundedRects).toBeGreaterThanOrEqual(5);
    const texts = recording.texts.map((call) => call.text);
    expect(texts).toEqual(
      expect.arrayContaining([
        "LEVEL",
        "SCORE",
        "TIME",
        "LIVES",
        "FREEBIES",
        "NICE CATCH!",
      ]),
    );
    expect(
      recording.texts.some((call) => call.font.includes("ArcadeTest")),
    ).toBe(true);
  });
});
