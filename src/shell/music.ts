import type { AudioBus } from "./contract";

interface MusicElement {
  src: string;
  loop: boolean;
  preload: string;
  volume: number;
  muted: boolean;
  currentTime: number;
  play(): Promise<void> | void;
  pause(): void;
  removeAttribute(name: string): void;
  load(): void;
}

export interface MusicController {
  start(): void;
  pause(): void;
  resume(): void;
  stop(): void;
  destroy(): void;
}

const noopController: MusicController = {
  start() {},
  pause() {},
  resume() {},
  stop() {},
  destroy() {},
};

/**
 * Host-owned file music. This deliberately sits OUTSIDE the frozen AudioBus:
 * games still register synth SFX through contract v1, while an optional
 * registry hint supplies presentation-only background music.
 */
export function createMusicController({
  src,
  audioBus,
  makeAudio = () => new Audio(),
}: {
  src?: string;
  audioBus: AudioBus;
  makeAudio?: () => MusicElement;
}): MusicController {
  if (!src) return noopController;

  const element = makeAudio();
  let active = false;
  let paused = false;
  let destroyed = false;
  let sourceAttached = false;

  element.loop = true;
  element.preload = "none";
  element.volume = 0.18;
  element.muted = audioBus.muted;

  const attachSource = () => {
    if (sourceAttached) return;
    sourceAttached = true;
    element.src = src;
  };

  const tryPlay = () => {
    if (destroyed || !active || paused || audioBus.muted) return;
    attachSource();
    try {
      const result = element.play();
      if (result && typeof result.catch === "function") {
        void result.catch(() => undefined);
      }
    } catch {
      // Autoplay denial is expected after async counted issuance. The next
      // genuine pointer/key gesture retries through the capture listeners.
    }
  };

  const onGesture = () => tryPlay();
  window.addEventListener("pointerdown", onGesture, { capture: true });
  window.addEventListener("keydown", onGesture, { capture: true });
  const unsubscribeMute = audioBus.onMutedChange((muted) => {
    element.muted = muted;
    if (muted) element.pause();
    else tryPlay();
  });

  return {
    start() {
      if (destroyed) return;
      active = true;
      paused = false;
      element.currentTime = 0;
      tryPlay();
    },
    pause() {
      if (destroyed) return;
      paused = true;
      element.pause();
    },
    resume() {
      if (destroyed || !active) return;
      paused = false;
      tryPlay();
    },
    stop() {
      if (destroyed) return;
      active = false;
      paused = false;
      element.pause();
      element.currentTime = 0;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      active = false;
      element.pause();
      window.removeEventListener("pointerdown", onGesture, { capture: true });
      window.removeEventListener("keydown", onGesture, { capture: true });
      unsubscribeMute();
      element.removeAttribute("src");
      element.load();
    },
  };
}
