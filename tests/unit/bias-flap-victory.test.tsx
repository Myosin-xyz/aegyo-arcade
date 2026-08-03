import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BiasFlapVictory } from "@/shell/bias-flap-victory";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("Bias Flap victory presentation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  async function renderVictory(props: { respectReducedMotion?: boolean } = {}) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const complete = vi.fn();
    await act(async () => {
      root.render(<BiasFlapVictory onComplete={complete} {...props} />);
    });
    return { host, root, complete };
  }

  it("plays the supplied inline video and completes once when it ends", async () => {
    const { host, root, complete } = await renderVictory();
    const video = host.querySelector("video");
    expect(video).toBeTruthy();
    expect(video?.getAttribute("src")).toBe("/games/flappy/victory-v1.mp4");
    expect(video?.autoplay).toBe(true);
    expect(video?.muted).toBe(true);
    expect(video?.playsInline).toBe(true);

    act(() => video?.dispatchEvent(new Event("ended")));
    act(() => video?.dispatchEvent(new Event("ended")));
    expect(complete).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it("fails open if the video cannot load or emit an ended event", async () => {
    const { host, root, complete } = await renderVictory();
    const video = host.querySelector("video");
    act(() => video?.dispatchEvent(new Event("error")));
    expect(complete).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it("uses a bounded fallback if an embedded browser stalls playback", async () => {
    const { root, complete } = await renderVictory();
    act(() => vi.advanceTimersByTime(6_499));
    expect(complete).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(complete).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it("skips motion immediately for reduced-motion users", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { root, complete } = await renderVictory();
    expect(complete).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it("can override reduced motion on the local visual-QA surface", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const { root, complete } = await renderVictory({
      respectReducedMotion: false,
    });
    expect(complete).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
