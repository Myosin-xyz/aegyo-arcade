import { describe, expect, it, vi } from "vitest";
import type { AudioBus } from "@/shell/contract";
import { createMusicController } from "@/shell/music";

function makeBus(
  initialMuted = false,
): AudioBus & { emitMute(v: boolean): void } {
  let muted = initialMuted;
  const listeners = new Set<(value: boolean) => void>();
  return {
    register() {},
    play() {},
    unlocked: true,
    get muted() {
      return muted;
    },
    setMuted(value) {
      muted = value;
      for (const listener of listeners) listener(value);
    },
    emitMute(value) {
      this.setMuted(value);
    },
    onMutedChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      listeners.clear();
    },
  };
}

function makeElement() {
  return {
    src: "",
    loop: false,
    preload: "",
    volume: 1,
    muted: false,
    currentTime: 0,
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
    removeAttribute: vi.fn(function (this: { src: string }, name: string) {
      if (name === "src") this.src = "";
    }),
    load: vi.fn(),
  };
}

describe("shell music controller", () => {
  it("does not attach or fetch a track until a run starts", () => {
    const bus = makeBus();
    const element = makeElement();
    const music = createMusicController({
      src: "/games/music/snake.mp3",
      audioBus: bus,
      makeAudio: () => element,
    });
    expect(element.src).toBe("");
    expect(element.play).not.toHaveBeenCalled();

    music.start();
    expect(element.src).toBe("/games/music/snake.mp3");
    expect(element.play).toHaveBeenCalledTimes(1);
    expect(element.loop).toBe(true);
    expect(element.preload).toBe("none");
    expect(element.volume).toBeLessThan(0.25);
    music.destroy();
  });

  it("shares mute, pause/resume, stop and teardown with the host lifecycle", () => {
    const bus = makeBus(true);
    const element = makeElement();
    const music = createMusicController({
      src: "/games/music/flappy.mp3",
      audioBus: bus,
      makeAudio: () => element,
    });

    music.start();
    expect(element.src).toBe(""); // muted start does not even fetch
    bus.emitMute(false);
    expect(element.src).toBe("/games/music/flappy.mp3");
    expect(element.play).toHaveBeenCalledTimes(1);

    music.pause();
    expect(element.pause).toHaveBeenCalledTimes(1);
    music.resume();
    expect(element.play).toHaveBeenCalledTimes(2);
    music.stop();
    expect(element.currentTime).toBe(0);

    music.destroy();
    expect(element.removeAttribute).toHaveBeenCalledWith("src");
    expect(element.load).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    expect(element.play).toHaveBeenCalledTimes(2);
  });

  it("swallows autoplay rejection and retries on the next genuine gesture", async () => {
    const bus = makeBus();
    const element = makeElement();
    element.play.mockRejectedValueOnce(
      new DOMException("blocked", "NotAllowedError"),
    );
    const music = createMusicController({
      src: "/games/music/jumper.mp3",
      audioBus: bus,
      makeAudio: () => element,
    });
    music.start();
    await Promise.resolve();
    window.dispatchEvent(new PointerEvent("pointerdown"));
    expect(element.play).toHaveBeenCalledTimes(2);
    music.destroy();
  });
});
