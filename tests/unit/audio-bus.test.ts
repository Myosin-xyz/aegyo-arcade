/**
 * AudioBus behavior (M4 review P1: the audio lane had zero behavioral
 * tests): synth registration + firing, capture-phase unlock ordering
 * (the first gesture's OWN sound must not be dropped), lazy in-play
 * unlock, mute gating, and teardown.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAudioBus } from "@/shell/audio";

class FakeAudioContext {
  currentTime = 0;
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);
}

beforeEach(() => {
  vi.stubGlobal("AudioContext", FakeAudioContext);
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AudioBus — behavioral", () => {
  it("registered synth fires after a gesture unlock; unregistered names no-op", () => {
    const bus = createAudioBus();
    const synth = vi.fn();
    bus.register("ping", synth);
    window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    bus.play("ping");
    expect(synth).toHaveBeenCalledTimes(1);
    bus.play("unknown"); // silently ignored
    expect(synth).toHaveBeenCalledTimes(1);
    bus.destroy();
  });

  it("CAPTURE-phase unlock: a bubble-phase input handler's play() lands on the first gesture (M4 review P2)", () => {
    const bus = createAudioBus();
    const synth = vi.fn();
    bus.register("flap", synth);
    // Simulate an InputBus-style bubble handler that plays on the very
    // first gesture — the bus must already be unlocked when it runs.
    const gameHandler = () => bus.play("flap");
    window.addEventListener("pointerdown", gameHandler);
    window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    window.removeEventListener("pointerdown", gameHandler);
    expect(synth).toHaveBeenCalledTimes(1);
    bus.destroy();
  });

  it("CONTRACT: play() is a strict no-op before any gesture unlock", () => {
    const bus = createAudioBus();
    const synth = vi.fn();
    bus.register("hop", synth);
    expect(bus.unlocked).toBe(false);
    bus.play("hop"); // no gesture yet — must stay silent AND locked
    expect(synth).not.toHaveBeenCalled();
    expect(bus.unlocked).toBe(false);
    // The genuine gesture unlock then restores sound.
    window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    bus.play("hop");
    expect(synth).toHaveBeenCalledTimes(1);
    bus.destroy();
  });

  it("mute gates play; unmute restores after a real unlock; destroy silences", () => {
    const bus = createAudioBus();
    const synth = vi.fn();
    bus.register("ping", synth);
    bus.setMuted(true);
    bus.play("ping");
    expect(synth).not.toHaveBeenCalled();
    expect(bus.unlocked).toBe(false); // muted play must not unlock
    window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    bus.play("ping");
    expect(synth).not.toHaveBeenCalled(); // still muted post-unlock
    bus.setMuted(false);
    bus.play("ping");
    expect(synth).toHaveBeenCalledTimes(1);
    bus.destroy();
    bus.play("ping");
    expect(synth).toHaveBeenCalledTimes(1);
  });

  it("a throwing synth never breaks play()", () => {
    const bus = createAudioBus();
    bus.register("bad", () => {
      throw new Error("synth exploded");
    });
    window.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(() => bus.play("bad")).not.toThrow();
    bus.destroy();
  });
});
