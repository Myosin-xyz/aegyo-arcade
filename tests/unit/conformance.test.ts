/**
 * Contract conformance suite (TECH_SPEC §6.1, §16.1) — drives GameInstance
 * lifecycles through a minimal non-React driver that applies the same state
 * rules as the host. The React host itself is exercised in a real browser by
 * the Playwright spike (tests/e2e).
 */

import { afterEach, describe, expect, it } from "vitest";
import type {
  GameContext,
  GameDefinition,
  GameInstance,
  LifecycleState,
  RunContext,
} from "@/shell/contract";
import { canStart } from "@/shell/contract";
import { createInputBus } from "@/shell/input";
import { createAudioBus } from "@/shell/audio";
import { seededRandom } from "@/shell/rng";
import { LeakTracker } from "@/shell/conformance";
import { t } from "@/i18n/t";
import { createHostileDefinition } from "../fixtures/hostile";
import { listGames } from "@/games/registry";

interface Driver {
  instance: GameInstance;
  state: LifecycleState;
  acceptedEnds: number;
  rawEnds: number;
  lastScore: number;
  init(signal: AbortSignal): Promise<void>;
  start(): void;
  tick(times?: number): void;
  destroy(): void;
  cleanupDom(): void;
}

function createDriver(definition: GameDefinition): Driver {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = document.createElement("div");
  host.appendChild(root);
  const input = createInputBus({
    target: root,
    toDesign: (x, y) => ({ x, y }),
  });
  const audio = createAudioBus();

  const driver = {
    state: "created" as LifecycleState,
    acceptedEnds: 0,
    rawEnds: 0,
    lastScore: 0,
  } as Driver;

  let endedThisRun = false;
  const ctx: GameContext = {
    host,
    surface: { kind: "dom", root },
    input,
    audio,
    t,
    report: {
      score: (score) => {
        if (!Number.isFinite(score) || score < 0) return;
        driver.lastScore = Math.floor(score);
      },
      end: () => {
        driver.rawEnds += 1;
        if (endedThisRun) return; // host rule: accepted once per run
        endedThisRun = true;
        driver.acceptedEnds += 1;
        driver.state = "ended";
      },
    },
  };

  const instance = definition.create(ctx);
  driver.instance = instance;

  driver.init = async (signal: AbortSignal) => {
    driver.state = "initializing";
    try {
      await instance.init(signal);
      driver.state = "ready";
    } catch (error) {
      driver.state = signal.aborted ? "destroyed" : "failed";
      throw error;
    }
  };

  driver.start = () => {
    if (!canStart(driver.state)) {
      throw new Error(`start rejected from ${driver.state}`);
    }
    endedThisRun = false;
    const seed = "conformance-seed";
    const run: RunContext = {
      mode: "practice",
      attemptId: null,
      seed,
      random: seededRandom(seed),
      signal: new AbortController().signal,
    };
    instance.start(run);
    driver.state = "running";
  };

  driver.tick = (times = 1) => {
    if (instance.loop !== "shell") return;
    for (let i = 0; i < times; i++) {
      instance.update(1000 / 60);
      instance.render(0);
    }
  };

  driver.destroy = () => {
    instance.destroy();
    driver.state = "destroyed";
  };

  driver.cleanupDom = () => {
    input.destroy();
    audio.destroy();
    host.remove();
  };

  return driver;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("lifecycle happy path", () => {
  it("init → start → run to end (accepted once) → restart → destroy, leak-free", async () => {
    const tracker = new LeakTracker();
    tracker.begin();

    const { definition, probe } = createHostileDefinition({
      endAfterTicks: 3,
    });
    const driver = createDriver(definition);
    await driver.init(new AbortController().signal);
    expect(driver.state).toBe("ready");

    driver.start();
    driver.tick(5);
    expect(driver.state).toBe("ended");
    expect(driver.acceptedEnds).toBe(1);
    expect(driver.lastScore).toBe(3);

    // §6.3: ended → running with a fresh RunContext on the SAME instance.
    driver.start();
    expect(driver.state).toBe("running");
    driver.tick(5);
    expect(driver.acceptedEnds).toBe(2);
    expect(probe.startCalls).toBe(2);
    expect(probe.initCalls).toBe(1);

    driver.destroy();
    driver.cleanupDom();
    const report = tracker.end();
    expect(report.clean, JSON.stringify(report)).toBe(true);
  });

  it("double end is ignored (end-at-most-once)", async () => {
    const { definition } = createHostileDefinition({
      endAfterTicks: 2,
      endTwice: true,
    });
    const driver = createDriver(definition);
    await driver.init(new AbortController().signal);
    driver.start();
    driver.tick(4);
    expect(driver.rawEnds).toBe(2);
    expect(driver.acceptedEnds).toBe(1);
    driver.destroy();
    driver.cleanupDom();
  });

  it("start is rejected while running or paused", async () => {
    const { definition } = createHostileDefinition({ endAfterTicks: 100 });
    const driver = createDriver(definition);
    await driver.init(new AbortController().signal);
    driver.start();
    expect(() => driver.start()).toThrow(/start rejected from running/);
    driver.instance.pause("system");
    driver.state = "paused";
    expect(() => driver.start()).toThrow(/start rejected from paused/);
    driver.destroy();
    driver.cleanupDom();
  });
});

describe("hostile init paths", () => {
  it("destroy-before-init-completes aborts cleanly with no leaks", async () => {
    const tracker = new LeakTracker();
    tracker.begin();

    const { definition, probe } = createHostileDefinition({
      initDelayMs: 60,
    });
    const driver = createDriver(definition);
    const abort = new AbortController();
    const initPromise = driver.init(abort.signal);

    abort.abort();
    driver.destroy();
    await expect(initPromise).rejects.toThrow();
    // destroy must be idempotent, including after aborted init.
    driver.destroy();
    expect(probe.destroyCalls).toBeGreaterThanOrEqual(2);

    driver.cleanupDom();
    const report = tracker.end();
    expect(report.clean, JSON.stringify(report)).toBe(true);
  });

  it("init failure lands in failed state; destroy stays safe", async () => {
    const { definition } = createHostileDefinition({ failInit: true });
    const driver = createDriver(definition);
    await expect(driver.init(new AbortController().signal)).rejects.toThrow(
      "hostile init failure",
    );
    expect(driver.state).toBe("failed");
    expect(() => {
      driver.destroy();
      driver.destroy();
    }).not.toThrow();
    driver.cleanupDom();
  });

  it("LeakTracker catches global-listener and timer leaks", async () => {
    const tracker = new LeakTracker();
    tracker.begin();

    const { definition } = createHostileDefinition({
      leakListener: true,
      leakTimer: true,
      endAfterTicks: 1,
    });
    const driver = createDriver(definition);
    await driver.init(new AbortController().signal);
    driver.start();
    driver.tick(2);
    driver.destroy();
    driver.cleanupDom();

    const report = tracker.end();
    expect(report.clean).toBe(false);
    expect(report.intervals).toBe(1);
    expect(
      report.listeners.some(
        (l) => l.target === "window" && l.type === "resize",
      ),
    ).toBe(true);
  });
});

describe("registry integrity", () => {
  it("every definition's metadata matches its registry entry", async () => {
    for (const entry of listGames()) {
      const definition = await entry.load();
      expect(definition.apiVersion).toBe(1);
      expect(definition.meta).toEqual(entry.meta);
    }
  });

  it("every game has a ready-overlay controls hint (M4 UX P1 — t() falls back to the raw key)", async () => {
    const { t } = await import("@/i18n/t");
    for (const entry of listGames()) {
      const key = `game.${entry.meta.id}.controls`;
      expect(t(key), key).not.toBe(key);
    }
  });

  it("registry counted capability ⇔ server COUNTED_GAMES entry (M2.5 review P1)", async () => {
    const { COUNTED_GAMES } = await import("@/server/games-config");
    const registryCounted = listGames()
      .filter((entry) => entry.meta.capabilities.counted)
      .map((entry) => entry.meta.id)
      .sort();
    const serverCounted = Object.keys(COUNTED_GAMES).sort();
    // A UI that advertises counted play the server rejects (or vice
    // versa) is a shipped-broken state — the sets must be identical.
    expect(registryCounted).toEqual(serverCounted);
  });
});

describe("shell services", () => {
  it("input bus: capturePointer=false never captures (dom-surface rule)", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    let captured = 0;
    (target as unknown as { setPointerCapture: () => void }).setPointerCapture =
      () => {
        captured += 1;
      };
    const bus = createInputBus({
      target,
      capturePointer: false,
      toDesign: (x, y) => ({ x, y }),
    });
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(captured).toBe(0); // real-browser click retargeting bug guard
    bus.destroy();
    target.remove();
  });

  it("input bus: subscribe/unsubscribe/destroy are clean and idempotent", () => {
    const tracker = new LeakTracker();
    tracker.begin();

    const target = document.createElement("div");
    document.body.appendChild(target);
    const bus = createInputBus({ target, toDesign: (x, y) => ({ x, y }) });

    const seen: string[] = [];
    const off = bus.onPointer((p) => seen.push(p.action));
    target.dispatchEvent(
      new MouseEvent("pointerdown", { clientX: 5, clientY: 6, bubbles: true }),
    );
    expect(seen).toEqual(["down"]);

    bus.setEnabled(false);
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(seen).toEqual(["down"]);
    bus.setEnabled(true);

    off();
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    expect(seen).toEqual(["down"]);

    bus.destroy();
    bus.destroy(); // idempotent
    target.remove();

    const report = tracker.end();
    expect(report.clean, JSON.stringify(report)).toBe(true);
  });

  it("seeded rng is deterministic per seed", () => {
    const a1 = seededRandom("seed-a");
    const a2 = seededRandom("seed-a");
    const b = seededRandom("seed-b");
    const seqA1 = [a1(), a1(), a1()];
    const seqA2 = [a2(), a2(), a2()];
    const seqB = [b(), b(), b()];
    expect(seqA1).toEqual(seqA2);
    expect(seqA1).not.toEqual(seqB);
    for (const v of seqA1) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
