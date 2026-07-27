/**
 * Host-level conformance (M0 review P1): the PRODUCTION GameHostInner —
 * not a parallel driver — must enforce the lifecycle state machine.
 * Renders the real component with the hostile fixture via an injected
 * registry entry.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GameHostInner } from "@/shell/host";
import type { RegistryEntry } from "@/games/registry";
import {
  createHostileDefinition,
  hostileMeta,
  type HostileOptions,
  type HostileProbe,
} from "../fixtures/hostile";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

interface Rendered {
  container: HTMLElement;
  root: Root;
  probe: HostileProbe;
}

async function renderHost(
  options: HostileOptions = {},
  entryOverrides: Partial<RegistryEntry> = {},
): Promise<Rendered> {
  const { definition, probe } = createHostileDefinition(options);
  const entry: RegistryEntry = {
    meta: hostileMeta,
    hostManagedCanvas: false,
    load: async () => definition,
    ...entryOverrides,
  };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<GameHostInner entry={entry} gameId={hostileMeta.id} />);
  });
  // Flush the async init effect to completion.
  await act(async () => {});
  return { container, root, probe };
}

function lifecycleOf(container: HTMLElement): string | null {
  return (
    container
      .querySelector('[data-testid="game-host"]')
      ?.getAttribute("data-lifecycle") ?? null
  );
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("GameHostInner lifecycle enforcement", () => {
  it("rejects a second synchronous start click (one RunContext only)", async () => {
    const { container, root, probe } = await renderHost({
      endAfterTicks: 1_000_000,
    });
    expect(lifecycleOf(container)).toBe("ready");

    const startButton = container.querySelector(
      '[data-testid="start-run"]',
    ) as HTMLButtonElement;
    expect(startButton).toBeTruthy();

    await act(async () => {
      // Two clicks in the SAME task — React hasn't re-rendered the overlay
      // away between them; only the ref guard can reject the second.
      startButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      startButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(probe.startCalls).toBe(1);
    expect(lifecycleOf(container)).toBe("running");

    await act(async () => {
      root.unmount();
    });
    expect(probe.destroyCalls).toBeGreaterThanOrEqual(1);
  });

  it("pause via window blur, resume via button, both ref-guarded", async () => {
    const { container, root, probe } = await renderHost({
      endAfterTicks: 1_000_000,
    });
    await act(async () => {
      (
        container.querySelector('[data-testid="start-run"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(lifecycleOf(container)).toBe("running");

    await act(async () => {
      window.dispatchEvent(new Event("blur"));
      // A second blur while already paused must be a no-op.
      window.dispatchEvent(new Event("blur"));
    });
    expect(lifecycleOf(container)).toBe("paused");
    expect(probe.pauseCalls).toBe(1);

    await act(async () => {
      (
        container.querySelector('[data-testid="resume-run"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(lifecycleOf(container)).toBe("running");
    expect(probe.resumeCalls).toBe(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("double-click on today's-run issues exactly ONE attempt (P2 guard)", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (url.includes("/api/session")) {
          return new Response("{}", { status: 200 });
        }
        if (url.includes("/api/runs")) {
          return new Response(
            JSON.stringify({
              attemptId: "11111111-1111-1111-1111-111111111111",
              seed: "double-click-seed",
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const { definition, probe } = createHostileDefinition({
      endAfterTicks: 1_000_000,
    });
    const countedMeta = {
      ...hostileMeta,
      capabilities: { counted: true, prize: false },
    };
    const entry: RegistryEntry = {
      meta: countedMeta,
      load: async () => ({ ...definition, meta: countedMeta }),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<GameHostInner entry={entry} gameId={countedMeta.id} />);
    });
    await act(async () => {});
    expect(lifecycleOf(container)).toBe("ready");

    const countedButton = container.querySelector(
      '[data-testid="start-counted"]',
    ) as HTMLButtonElement;
    expect(countedButton).toBeTruthy();
    await act(async () => {
      // Same-task double activation — only the synchronous ref can stop it.
      countedButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      countedButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});

    const issueCalls = calls.filter(
      (c) => c.startsWith("POST") && c.includes("/api/runs"),
    );
    expect(issueCalls).toHaveLength(1);
    expect(probe.startCalls).toBe(1);
    expect(lifecycleOf(container)).toBe("running");

    await act(async () => {
      root.unmount();
    });
    vi.unstubAllGlobals();
  });

  for (const mode of ["shell", "authored", "none"] as const) {
    it(`scorePresentation matrix — "${mode}" (M4.5 review P2, enum-complete)`, async () => {
      const { definition } = createHostileDefinition({ endAfterTicks: 2 });
      const entry: RegistryEntry = {
        meta: hostileMeta,
        ...(mode === "shell" ? {} : { scorePresentation: mode }),
        load: async () => definition,
      };
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(<GameHostInner entry={entry} gameId={hostileMeta.id} />);
      });
      await act(async () => {});

      // Header score span (aria-labelled with the value now) follows the mode.
      const headerScore = container.querySelector(
        'header [data-testid="header-score"]',
      );
      if (mode === "shell") expect(headerScore).toBeTruthy();
      else expect(headerScore).toBeNull();

      // Run to the generic ended overlay.
      const startButton = container.querySelector(
        '[data-testid="start-run"]',
      ) as HTMLButtonElement;
      await act(async () => {
        startButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
      });
      expect(lifecycleOf(container)).toBe("ended");

      const endedScore = container.querySelector('[data-testid="ended-score"]');
      const announcement =
        container.querySelector(".sr-only")?.textContent ?? "";
      if (mode === "none") {
        // No score concept: nothing visible, nothing announced.
        expect(endedScore).toBeNull();
        expect(announcement).toBe("");
      } else {
        expect(endedScore).toBeTruthy();
        expect(announcement).toContain("Score");
      }

      await act(async () => {
        root.unmount();
      });
    });
  }

  it("game-authored end: host Play Again restarts with a FRESH RunContext (M4.5 review P2)", async () => {
    const { definition, probe } = createHostileDefinition({
      endAfterTicks: 2, // ends almost immediately after start
    });
    const entry: RegistryEntry = {
      meta: hostileMeta,
      endPresentation: "game-authored",
      scorePresentation: "none",
      load: async () => definition,
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<GameHostInner entry={entry} gameId={hostileMeta.id} />);
    });
    await act(async () => {});
    expect(lifecycleOf(container)).toBe("ready");

    const startButton = container.querySelector(
      '[data-testid="start-run"]',
    ) as HTMLButtonElement;
    await act(async () => {
      startButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // Drive the loop until the game self-ends.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    expect(lifecycleOf(container)).toBe("ended");
    const firstRun = probe.lastRun!;
    expect(firstRun).toBeTruthy();

    // The authored-end presentation renders the HOST Play Again (no
    // dark overlay markup); clicking it must mint a NEW RunContext.
    const playAgain = container.querySelector(
      '[data-testid="play-again"]',
    ) as HTMLButtonElement;
    expect(playAgain).toBeTruthy();
    await act(async () => {
      playAgain.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    expect(lifecycleOf(container)).toBe("running");
    expect(probe.startCalls).toBe(2);
    const secondRun = probe.lastRun!;
    expect(secondRun).not.toBe(firstRun); // fresh RunContext object
    expect(secondRun.signal).not.toBe(firstRun.signal); // fresh abort
    expect(secondRun.seed).not.toBe(firstRun.seed); // fresh practice seed

    await act(async () => {
      root.unmount();
    });
  });

  it("?seed= pins PRACTICE only — counted runs keep the server seed (M3 review P2)", async () => {
    // Hostile visitor lands with a chosen seed in the URL.
    window.history.replaceState(null, "", "/play/hostile?seed=attacker");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/api/session")) {
          return new Response("{}", { status: 200 });
        }
        if (url.includes("/api/runs")) {
          return new Response(
            JSON.stringify({
              attemptId: "22222222-2222-2222-2222-222222222222",
              seed: "server-issued-seed",
            }),
            { status: 200 },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const { definition, probe } = createHostileDefinition({
      endAfterTicks: 1_000_000,
    });
    const countedMeta = {
      ...hostileMeta,
      capabilities: { counted: true, prize: false },
    };
    const entry: RegistryEntry = {
      meta: countedMeta,
      load: async () => ({ ...definition, meta: countedMeta }),
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<GameHostInner entry={entry} gameId={countedMeta.id} />);
    });
    await act(async () => {});
    expect(lifecycleOf(container)).toBe("ready");

    // The hook itself: a PRACTICE run adopts the pinned seed.
    const practiceButton = container.querySelector(
      '[data-testid="start-run"]',
    ) as HTMLButtonElement;
    await act(async () => {
      practiceButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    expect(probe.lastRun?.mode).toBe("practice");
    expect(probe.lastRun?.seed).toBe("attacker");

    // Back to ready via the hostile end path, then start a COUNTED run.
    await act(async () => {
      root.unmount();
    });
    document.body.replaceChildren();
    const container2 = document.createElement("div");
    document.body.appendChild(container2);
    const root2 = createRoot(container2);
    await act(async () => {
      root2.render(<GameHostInner entry={entry} gameId={countedMeta.id} />);
    });
    await act(async () => {});
    const countedButton2 = container2.querySelector(
      '[data-testid="start-counted"]',
    ) as HTMLButtonElement;
    await act(async () => {
      countedButton2.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});

    // The competitive-safety invariant: the URL seed NEVER reaches a
    // counted run — seed and RNG stream are the server-issued ones.
    expect(probe.lastRun?.mode).toBe("counted");
    expect(probe.lastRun?.seed).toBe("server-issued-seed");
    expect(probe.lastRun?.seed).not.toBe("attacker");

    await act(async () => {
      root2.unmount();
    });
    window.history.replaceState(null, "", "/");
    vi.unstubAllGlobals();
  });

  it("input delivered while PAUSED never reaches the game (P1 regression)", async () => {
    const { container, root, probe } = await renderHost({
      endAfterTicks: 1_000_000,
    });
    await act(async () => {
      (
        container.querySelector('[data-testid="start-run"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const surface = container.querySelector(
      '[data-testid="game-surface"]',
    ) as HTMLElement; // the exact element the InputBus targets
    surface.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 5, clientY: 5, bubbles: true }),
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    const deliveredWhileRunning = probe.inputEvents;
    expect(deliveredWhileRunning).toBeGreaterThan(0);

    await act(async () => {
      window.dispatchEvent(new Event("blur")); // → paused
    });
    expect(lifecycleOf(container)).toBe("paused");
    surface.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 6, clientY: 6, bubbles: true }),
    );
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space" }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "ArrowUp" }));
    expect(probe.inputEvents).toBe(deliveredWhileRunning); // NOTHING delivered

    await act(async () => {
      (
        container.querySelector('[data-testid="resume-run"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    surface.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 7, clientY: 7, bubbles: true }),
    );
    expect(probe.inputEvents).toBe(deliveredWhileRunning + 1); // flowing again

    await act(async () => {
      root.unmount();
    });
  });

  it("init failure tears down and Retry ACTUALLY re-inits to ready", async () => {
    // Fails once, succeeds on the retry (M0 review: the old test never
    // clicked Retry).
    const { container, root, probe } = await renderHost({ failInitTimes: 1 });
    expect(lifecycleOf(container)).toBe("failed");
    expect(probe.initCalls).toBe(1);
    // Failed instance was destroyed immediately, not left half-alive.
    expect(probe.destroyCalls).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('[data-testid="start-run"]')).toBeNull();

    await act(async () => {
      (
        container.querySelector('[data-testid="retry-init"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});
    expect(probe.initCalls).toBe(2);
    expect(lifecycleOf(container)).toBe("ready");

    await act(async () => {
      root.unmount();
    });
  });

  it("a game that THROWS from start() lands in failed with full teardown", async () => {
    const { container, root, probe } = await renderHost({ throwOnStart: true });
    await act(async () => {
      (
        container.querySelector('[data-testid="start-run"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(lifecycleOf(container)).toBe("failed");
    expect(probe.destroyCalls).toBeGreaterThanOrEqual(1);
    expect(probe.updateTicks).toBe(0); // loop never started
    expect(container.querySelector('[data-testid="retry-init"]')).toBeTruthy();
    await act(async () => {
      root.unmount();
    });
  });

  it("a game that ends synchronously from start() stays ended (no loop)", async () => {
    const { container, root, probe } = await renderHost({ endOnStart: true });
    await act(async () => {
      (
        container.querySelector('[data-testid="start-run"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // "ended" must not be overwritten by "running", and the loop must not
    // have driven any frames (M0 review edge).
    expect(lifecycleOf(container)).toBe("ended");
    expect(probe.updateTicks).toBe(0);
    expect(probe.renders).toBe(0);
    expect(container.querySelector('[data-testid="play-again"]')).toBeTruthy();
    await act(async () => {
      root.unmount();
    });
  });

  it("the surface is INERT under a blocking overlay and live while running", async () => {
    // A scrim that only covers the surface visually leaves DOM games
    // underneath tabbable and screen-reader reachable — Hangman's letter
    // keys and This-or-That's choices were both reachable behind the ready
    // screen (operator review, 2026-07-26).
    const { container, root } = await renderHost({ endAfterTicks: 1_000_000 });
    const inert = () =>
      (
        container.querySelector(
          '[data-testid="game-surface-frame"]',
        ) as HTMLElement
      ).hasAttribute("inert");

    expect(lifecycleOf(container)).toBe("ready");
    expect(inert(), "ready overlay").toBe(true);

    await act(async () => {
      (
        container.querySelector('[data-testid="start-run"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(lifecycleOf(container)).toBe("running");
    expect(inert(), "running — the game must be playable").toBe(false);

    await act(async () => {
      window.dispatchEvent(new Event("blur")); // → paused
    });
    expect(lifecycleOf(container)).toBe("paused");
    expect(inert(), "paused overlay").toBe(true);

    await act(async () => {
      (
        container.querySelector('[data-testid="resume-run"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(inert(), "resumed").toBe(false);

    await act(async () => {
      root.unmount();
    });
  });

  it("ended surfaces offer Challenge-your-friend; clipboard fallback carries the game link", async () => {
    // jsdom has no navigator.share, so the button exercises the clipboard
    // fallback — the same path a desktop browser takes.
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: (s: string) => (written.push(s), Promise.resolve()) },
    });

    const { container, root } = await renderHost({ endOnStart: true });
    await act(async () => {
      (
        container.querySelector('[data-testid="start-run"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(lifecycleOf(container)).toBe("ended");

    const btn = container.querySelector(
      '[data-testid="challenge-friend"]',
    ) as HTMLElement;
    expect(btn, "share CTA missing from the ended overlay").toBeTruthy();
    await act(async () => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(written).toHaveLength(1);
    expect(written[0]).toContain(`/play/${hostileMeta.id}`);
    // Confirmation state so the tap visibly did something. (The button
    // resolves copy via the global i18n `t`, not the ctx stub, so the
    // real EN string is what renders here.)
    expect(btn.textContent).toBe("Link copied!");

    await act(async () => {
      root.unmount();
    });
  });

  it("a game-authored ended result stays reachable (NOT inert)", async () => {
    // This case has no scrim: the game's own result IS the content, so
    // making it inert would hide the outcome from assistive tech.
    const { container, root } = await renderHost(
      { endOnStart: true },
      { endPresentation: "game-authored" },
    );
    await act(async () => {
      (
        container.querySelector('[data-testid="start-run"]') as HTMLElement
      ).dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(lifecycleOf(container)).toBe("ended");
    expect(
      (
        container.querySelector(
          '[data-testid="game-surface-frame"]',
        ) as HTMLElement
      ).hasAttribute("inert"),
    ).toBe(false);
    await act(async () => {
      root.unmount();
    });
  });
});
