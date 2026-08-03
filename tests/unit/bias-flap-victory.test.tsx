import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BiasFlapVictory } from "@/shell/bias-flap-victory";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function canvasContext(): CanvasRenderingContext2D {
  const gradient = { addColorStop: vi.fn() };
  return new Proxy(
    {},
    {
      get(target, property) {
        if (property === "createLinearGradient") return () => gradient;
        const value = (target as Record<PropertyKey, unknown>)[property];
        return value ?? (() => undefined);
      },
      set(target, property, value) {
        (target as Record<PropertyKey, unknown>)[property] = value;
        return true;
      },
    },
  ) as CanvasRenderingContext2D;
}

describe("Bias Flap victory presentation", () => {
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    frames = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      canvasContext(),
    );
    vi.spyOn(performance, "now").mockReturnValue(0);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("draws the reference-inspired sequence for five seconds, then completes once", async () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const complete = vi.fn();
    await act(async () => {
      root.render(<BiasFlapVictory onComplete={complete} />);
    });
    expect(host.querySelector("canvas")).toBeTruthy();
    expect(frames).toHaveLength(1);

    act(() => frames.shift()?.(2_500));
    expect(complete).not.toHaveBeenCalled();
    expect(frames).toHaveLength(1);
    act(() => frames.shift()?.(5_001));
    expect(complete).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it("skips motion immediately for reduced-motion users", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const complete = vi.fn();
    await act(async () => {
      root.render(<BiasFlapVictory onComplete={complete} />);
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(frames).toHaveLength(0);
    await act(async () => root.unmount());
  });
});
