import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GameCardPreview } from "@/app/game-card-preview";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function stubMedia({ reduced = false, hover = true } = {}) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("reduced-motion") ? reduced : hover,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

async function renderPreview() {
  const host = document.createElement("a");
  host.href = "/play/example";
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <GameCardPreview
        poster="/preview.webp"
        video="/preview.mp4"
        testId="preview"
      />,
    );
  });
  return { host, root, video: host.querySelector("video")! };
}

describe("game card preview", () => {
  beforeEach(() => {
    stubMedia();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("keeps video lazy and plays only while hovered or focused", async () => {
    const { host, root, video } = await renderPreview();
    expect(video.preload).toBe("none");
    expect(video.muted).toBe(true);
    expect(video.loop).toBe(true);
    expect(video.playsInline).toBe(true);
    expect(video.poster).toContain("/preview.webp");
    expect(video.getAttribute("src")).toBeNull();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    await act(async () => {
      video.parentElement?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
    });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    expect(video.getAttribute("src")).toBe("/preview.mp4");

    await act(async () => {
      video.parentElement?.dispatchEvent(
        new MouseEvent("mouseout", { bubbles: true }),
      );
    });
    await act(async () => host.focus());
    expect(video.dataset.active).toBe("true");
    await act(async () => host.blur());
    expect(video.dataset.active).toBe("false");
    expect(video.getAttribute("src")).toBeNull();
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    expect(video.currentTime).toBe(0);
    await act(async () => root.unmount());
  });

  it("keeps the poster static when reduced motion is requested", async () => {
    stubMedia({ reduced: true });
    const { root, video } = await renderPreview();
    await act(async () => {
      video.parentElement?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      );
    });
    expect(video.dataset.active).toBe("false");
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it("plays on touch only after most of the card is visible", async () => {
    stubMedia({ hover: false });
    let notifyIntersection:
      ((entries: IntersectionObserverEntry[]) => void) | undefined;
    const disconnect = vi.fn();
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          notifyIntersection = (entries) =>
            callback(entries, this as unknown as IntersectionObserver);
        }
        observe() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        disconnect = disconnect;
        root = null;
        rootMargin = "0px";
        thresholds = [0, 0.75, 1];
      },
    );
    const { root, video } = await renderPreview();
    expect(video.getAttribute("src")).toBeNull();

    await act(async () => {
      notifyIntersection?.([
        { intersectionRatio: 0.74 } as IntersectionObserverEntry,
      ]);
    });
    expect(video.getAttribute("src")).toBeNull();
    await act(async () => {
      notifyIntersection?.([
        { intersectionRatio: 0.8 } as IntersectionObserverEntry,
      ]);
    });
    expect(video.getAttribute("src")).toBe("/preview.mp4");
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it("activates only the best-visible preview when several mobile cards qualify", async () => {
    stubMedia({ hover: false });
    const callbacks: IntersectionObserverCallback[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: IntersectionObserverCallback) {
          callbacks.push(callback);
        }
        observe() {}
        unobserve() {}
        takeRecords() {
          return [];
        }
        disconnect() {}
        root = null;
        rootMargin = "0px";
        thresholds = [0, 0.75, 1];
      },
    );

    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <>
          {[0, 1, 2].map((index) => (
            <a href={`/play/${index}`} key={index}>
              <GameCardPreview
                poster={`/preview-${index}.webp`}
                video={`/preview-${index}.mp4`}
                testId={`preview-${index}`}
              />
            </a>
          ))}
        </>,
      );
    });
    expect(callbacks).toHaveLength(3);

    await act(async () => {
      callbacks.forEach((callback, index) =>
        callback(
          [
            {
              intersectionRatio: 1,
              boundingClientRect: {
                top: index * 300,
                height: 300,
              },
            } as IntersectionObserverEntry,
          ],
          {} as IntersectionObserver,
        ),
      );
      await Promise.resolve();
    });

    const videos = [...host.querySelectorAll("video")];
    expect(videos.filter((video) => video.dataset.active === "true")).toEqual([
      videos[1],
    ]);
    expect(videos.filter((video) => video.getAttribute("src"))).toEqual([
      videos[1],
    ]);
    await act(async () => root.unmount());
  });
});
