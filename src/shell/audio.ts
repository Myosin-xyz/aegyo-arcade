/**
 * AudioBus (TECH_SPEC §6.3): one shell-owned AudioContext, unlocked on the
 * first user gesture, global mute persisted per device, synth-registered SFX
 * (no audio files), idempotent teardown. Games never create their own
 * AudioContext.
 */

import type { AudioBus } from "./contract";

const MUTE_STORAGE_KEY = "aegyo-arcade:muted";

export function createAudioBus(): AudioBus {
  const synths = new Map<string, (ctx: AudioContext, at: number) => void>();
  const muteListeners = new Set<(muted: boolean) => void>();
  let ctx: AudioContext | null = null;
  let unlocked = false;
  let destroyed = false;
  let muted = readStoredMute();

  const unlock = (): void => {
    if (unlocked || destroyed) return;
    try {
      ctx = new AudioContext();
      void ctx.resume();
      unlocked = true;
    } catch {
      // No audio support — bus stays silent, gameplay unaffected.
    }
    removeUnlockListeners();
  };

  // Any first gesture on the page unlocks; listeners self-remove.
  const removeUnlockListeners = (): void => {
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);

  return {
    register(name, synth) {
      if (destroyed) return;
      synths.set(name, synth);
    },
    play(name) {
      if (destroyed || muted || !unlocked || !ctx) return;
      const synth = synths.get(name);
      if (!synth) return;
      try {
        synth(ctx, ctx.currentTime);
      } catch {
        // A broken SFX must never break gameplay.
      }
    },
    get unlocked() {
      return unlocked;
    },
    get muted() {
      return muted;
    },
    setMuted(next) {
      muted = next;
      try {
        localStorage.setItem(MUTE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Storage unavailable (private mode) — session-only mute.
      }
      for (const listener of muteListeners) listener(next);
    },
    onMutedChange(listener) {
      muteListeners.add(listener);
      return () => muteListeners.delete(listener);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      removeUnlockListeners();
      synths.clear();
      muteListeners.clear();
      if (ctx) {
        void ctx.close().catch(() => undefined);
        ctx = null;
      }
    },
  };
}

function readStoredMute(): boolean {
  try {
    return localStorage.getItem(MUTE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
