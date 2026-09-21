import { describe, expect, it } from "vitest";
import { DESIGN_H, DESIGN_W } from "@/games/perfect-toss/logic";
import {
  tossStickPose,
  type PerfectTossAsset,
  type PerfectTossImages,
} from "@/games/perfect-toss/render";

// Pixel sizes of the delivered sprites the hand anchors were measured on.
const SPRITE_SIZES: Record<PerfectTossAsset, readonly [number, number]> = {
  boy_throw: [220, 357],
  boy_catch: [220, 351],
  boy_sad: [220, 415],
  boy_happy: [220, 377],
  girl_throw: [220, 360],
  girl_catch: [220, 341],
  girl_sad: [220, 440],
  girl_happy: [220, 417],
  lightstick: [140, 225],
};

const images = Object.fromEntries(
  Object.entries(SPRITE_SIZES).map(([name, [naturalWidth, naturalHeight]]) => [
    name,
    { naturalWidth, naturalHeight, complete: true },
  ]),
) as unknown as PerfectTossImages;

const CHARACTER_HEIGHT = DESIGN_W * 0.09 * 3.6;
const GROUND_Y = DESIGN_H * 0.72;
const FAN_X = DESIGN_W * 0.84;
const FAN_TOP = GROUND_Y - CHARACTER_HEIGHT;
const FAN_HALF_WIDTH = (CHARACTER_HEIGHT * (220 / 341)) / 2;

describe("Perfect Toss lightstick flight", () => {
  it("releases from the idol's outstretched fist", () => {
    const pose = tossStickPose(images, { offset: 0, result: "perfect" }, 0);
    expect(pose.x).toBeLessThan(DESIGN_W * 0.3);
    expect(pose.y).toBeLessThan(GROUND_Y - CHARACTER_HEIGHT * 0.5);
    expect(pose.angle).toBe(0);
  });

  it.each(["good", "perfect"] as const)(
    "delivers a %s throw into the fan's raised hands",
    (result) => {
      const pose = tossStickPose(images, { offset: 0.02, result }, 1);
      // girl_catch's cupped hands fill the top-left of her sprite.
      expect(pose.x).toBeGreaterThan(FAN_X - FAN_HALF_WIDTH);
      expect(pose.x).toBeLessThan(FAN_X);
      expect(pose.y).toBeGreaterThanOrEqual(FAN_TOP);
      expect(pose.y).toBeLessThan(FAN_TOP + CHARACTER_HEIGHT * 0.25);
      expect(pose.behindFan).toBe(false);
      // Two full turns, so it arrives upright with the handle down.
      expect(pose.angle).toBeCloseTo(Math.PI * 4);
    },
  );

  it("drops an early miss on the ground in front of the fan", () => {
    const pose = tossStickPose(images, { offset: -0.4, result: "miss" }, 1);
    expect(pose.x).toBeLessThan(FAN_X - FAN_HALF_WIDTH);
    expect(pose.x).toBeGreaterThan(DESIGN_W * 0.3);
    expect(pose.y).toBeGreaterThan(GROUND_Y - 20);
    expect(pose.y).toBeLessThan(GROUND_Y);
    expect(pose.behindFan).toBe(false);
  });

  it("sends a late miss over the fan to land behind her", () => {
    const pose = tossStickPose(images, { offset: 0.4, result: "miss" }, 1);
    expect(pose.x).toBeGreaterThan(FAN_X + FAN_HALF_WIDTH);
    expect(pose.x).toBeLessThan(DESIGN_W);
    expect(pose.y).toBeGreaterThan(GROUND_Y - 20);
    expect(pose.behindFan).toBe(true);
  });

  it("lands a wider early miss further from the fan", () => {
    const near = tossStickPose(images, { offset: -0.1, result: "miss" }, 1);
    const far = tossStickPose(images, { offset: -0.5, result: "miss" }, 1);
    const wild = tossStickPose(images, { offset: -0.95, result: "miss" }, 1);
    expect(far.x).toBeLessThan(near.x);
    // Even the worst throw stays clear of the idol who threw it.
    expect(wild.x).toBeGreaterThan(DESIGN_W * 0.3);
  });

  it("lifts a wider late miss higher over the fan's head", () => {
    const mild = tossStickPose(images, { offset: 0.1, result: "miss" }, 0.5);
    const wild = tossStickPose(images, { offset: 0.6, result: "miss" }, 0.5);
    expect(wild.y).toBeLessThan(mild.y);
  });

  it("clears the fan's head before an overthrown stick comes down", () => {
    const fanFrontEdge = FAN_X - FAN_HALF_WIDTH;
    for (let step = 0; step <= 100; step += 1) {
      const pose = tossStickPose(
        images,
        { offset: 0.35, result: "miss" },
        step / 100,
      );
      if (pose.x < fanFrontEdge) continue;
      expect(pose.y).toBeLessThan(FAN_TOP);
      return;
    }
    throw new Error("the overthrown stick never reached the fan");
  });
});
