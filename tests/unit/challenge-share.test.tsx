/**
 * Challenge-your-friend failure ladder (review P2): native share →
 * clipboard → visible error, with a CANCELLED sheet — and only that —
 * staying silent. A swallowed non-Abort failure made the CTA silently do
 * nothing on browsers where `navigator.share` exists but rejects.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChallengeShareButton } from "@/shell/challenge-share";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface Mounted {
  button: HTMLButtonElement;
  root: Root;
  click: () => Promise<void>;
}

async function mount(): Promise<Mounted> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <ChallengeShareButton
        gameId="snake"
        gameTitle="Snake Freebies"
        score={120}
      />,
    );
  });
  const button = container.querySelector(
    '[data-testid="challenge-friend"]',
  ) as HTMLButtonElement;
  const click = async () => {
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
  };
  return { button, root, click };
}

function stubShare(impl: (() => Promise<void>) | undefined): void {
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: impl,
  });
}

function stubClipboard(writeText: ((s: string) => Promise<void>) | null): void {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  // Remove the stubs so other suites see jsdom's defaults again.
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { clipboard?: unknown }).clipboard;
  document.body.replaceChildren();
});

describe("ChallengeShareButton failure ladder", () => {
  it("native share success: OS sheet only, clipboard untouched, label unchanged", async () => {
    const shared: unknown[] = [];
    stubShare((...args: unknown[]) => (shared.push(args), Promise.resolve()));
    const written: string[] = [];
    stubClipboard((s) => (written.push(s), Promise.resolve()));

    const { button, root, click } = await mount();
    await click();
    expect(shared).toHaveLength(1);
    expect(written).toHaveLength(0);
    expect(button.dataset.shareFeedback).toBe("idle");
    await act(async () => root.unmount());
  });

  it("a CANCELLED sheet stays silent — no clipboard, no error copy", async () => {
    stubShare(() =>
      Promise.reject(new DOMException("user dismissed", "AbortError")),
    );
    const written: string[] = [];
    stubClipboard((s) => (written.push(s), Promise.resolve()));

    const { button, root, click } = await mount();
    await click();
    expect(written).toHaveLength(0); // changed their mind ≠ failure
    expect(button.dataset.shareFeedback).toBe("idle");
    await act(async () => root.unmount());
  });

  it("a NON-Abort native failure falls back to the clipboard with the game link", async () => {
    stubShare(() =>
      Promise.reject(new DOMException("denied by policy", "NotAllowedError")),
    );
    const written: string[] = [];
    stubClipboard((s) => (written.push(s), Promise.resolve()));

    const { button, root, click } = await mount();
    await click();
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("/play/snake");
    expect(written[0]).toContain("120"); // score carried into the text
    expect(button.dataset.shareFeedback).toBe("copied");
    await act(async () => root.unmount());
  });

  it("no share API and no clipboard: the button SAYS it failed instead of doing nothing", async () => {
    stubShare(undefined);
    stubClipboard(null);

    const { button, root, click } = await mount();
    await click();
    expect(button.dataset.shareFeedback).toBe("failed");
    expect(button.textContent).toContain("Couldn't share");
    await act(async () => root.unmount());
  });

  it("a DENIED clipboard also surfaces the failure state", async () => {
    stubShare(undefined);
    stubClipboard(() =>
      Promise.reject(new DOMException("denied", "NotAllowedError")),
    );

    const { button, root, click } = await mount();
    await click();
    expect(button.dataset.shareFeedback).toBe("failed");
    await act(async () => root.unmount());
  });
});
