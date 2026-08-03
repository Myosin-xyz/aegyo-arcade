/**
 * Registry-driven per-game smoke (§16.4): every registered game boots,
 * receives REAL input through its production input path, and — where the
 * game has a reachable terminal state — runs to an observable end panel.
 * The claw is the documented exception: practice mode has no terminal
 * state (attract loop), so its smoke proves boot + input + stability, and
 * its terminal behavior is covered by the counted-claw test below.
 *
 * Plus: full counted loops (snake generic-submit, claw game-owned) and
 * the §10.1 lost-response → same-attempt retry → receipt flow.
 */

import { expect, test, type Page } from "@playwright/test";
import { listGames } from "../../src/games/registry";

const needsDb = Boolean(process.env.CI) && !process.env.DATABASE_URL;

/** Game-specific input that drives the run to its terminal state. */
const SMOKE_ACTIONS: Record<
  string,
  {
    act: (page: Page) => Promise<void>;
    terminal: boolean;
    /** Override the default 20s ended-timeout for slower terminal paths. */
    endTimeoutMs?: number;
    /** Extra query string (e.g. a pinned practice seed). */
    urlQuery?: string;
  }
> = {
  snake: {
    // Snake Freebies (V1): 3 lives per level, so a single wall hit does
    // NOT end the run — drive into a wall repeatedly until all lives are
    // spent. ArrowDown also proves the first input arms the run.
    act: async (page) => {
      const host = page.getByTestId("game-host");
      await page.keyboard.press("ArrowDown");
      for (let i = 0; i < 60; i++) {
        if ((await host.getAttribute("data-lifecycle")) === "ended") return;
        // Alternate axes so the head keeps meeting a wall after respawn.
        await page.keyboard.press(i % 2 === 0 ? "ArrowDown" : "ArrowRight");
        await page.waitForTimeout(400);
      }
    },
    terminal: true,
    endTimeoutMs: 45_000,
  },
  flappy: {
    // Bias Flap: a crash RESTARTS the level (unlimited retries), so the
    // only reachable terminal path for a smoke is CASH-OUT — flap once
    // (arms the run and proves input), then ⏹ leave → LEAVE & SAVE. The
    // zones live in design space; the design box fills the surface
    // height, x-centered (CanvasSurfaceManager letterboxing).
    act: async (page) => {
      const surface = page.getByTestId("game-surface");
      const box = await surface.boundingBox();
      if (!box) throw new Error("flappy: no game-surface bounding box");
      const scale = box.height / 640;
      const originX = box.x + box.width / 2 - (360 * scale) / 2;
      const tap = async (dx: number, dy: number) =>
        page.mouse.click(originX + dx * scale, box.y + dy * scale);
      await tap(80, 400); // flap — arms the run
      await page.waitForTimeout(250);
      await tap(360 - 84 + 36, 12 + 27); // ⏹ leave zone center
      await page.waitForTimeout(250);
      await tap(180, 430); // LEAVE & SAVE zone center
    },
    terminal: true,
  },
  jumper: {
    // DaiDai port: exercise the MOBILE path, not the keyboard fallback.
    // Repeated taps in the outer-right quarter produce large impulses;
    // eventually all three safe-respawn lives are spent. A pinned seed
    // makes the generated platform/hazard field replayable.
    urlQuery: "?seed=comeback-smoke-0",
    act: async (page) => {
      const host = page.getByTestId("game-host");
      const surface = page.getByTestId("game-surface");
      const box = await surface.boundingBox();
      if (!box) throw new Error("jumper: no game-surface bounding box");
      for (let i = 0; i < 300; i++) {
        if ((await host.getAttribute("data-lifecycle")) === "ended") return;
        await page.mouse.click(
          box.x + box.width * 0.94,
          box.y + box.height * 0.55,
        );
        await page.waitForTimeout(120);
      }
    },
    terminal: true,
    endTimeoutMs: 60_000,
  },
  hangman: {
    // Six letters absent from every dictionary term → lost.
    act: async (page) => {
      for (const letter of ["Q", "X", "Z", "J", "V", "W"]) {
        await page.locator(`button[data-letter="${letter}"]`).click();
      }
    },
    terminal: true,
  },
  claw: {
    // Rail tap (ArrowLeft) + a depth STEP via keyboard (input proof for
    // both axes). ArrowUp, not Down: rest is the CLOSEST station now
    // (Daidai 2026-07-27), so Down at rest is a clamped no-op.
    act: async (page) => {
      await page.keyboard.press("ArrowLeft");
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(250);
    },
    terminal: false,
  },
  thisorthat: {
    // Nine picks reach the result → the run ends through the FROZEN
    // lifecycle; the game-authored end presentation keeps the in-DOM
    // result visible while the generic loop asserts ended + the host's
    // Play Again control (M4.5 review P1).
    act: async (page) => {
      for (let i = 0; i < 9; i++) {
        await page.getByTestId(`tot-card-${i % 2}`).click();
        await page.waitForTimeout(340); // double-tap lock window
      }
      await page.getByTestId("tot-result").waitFor({ state: "visible" }); // result stays visible at ended
    },
    terminal: true,
  },
  freebie: {
    // OBSERVABLE input proof (M2.5 review P2): hold ArrowLeft and require
    // pixels to change in the far-left strip of the catcher band — static
    // background unless the catcher actually travels there (the idle
    // catcher bobs at center; the first freebie needs ~9s to fall that
    // low, and we finish in ~2s). Then three drops end the run.
    act: async (page) => {
      const surface = page.getByTestId("game-surface");
      const box = await surface.boundingBox();
      if (!box) throw new Error("freebie: no game-surface bounding box");
      const clip = {
        x: box.x,
        y: box.y + (555 / 760) * box.height,
        width: (80 / 480) * box.width,
        height: (90 / 760) * box.height,
      };
      const before = await page.screenshot({ clip });
      await page.keyboard.down("ArrowLeft");
      await page.waitForTimeout(1500);
      await page.keyboard.up("ArrowLeft");
      const after = await page.screenshot({ clip });
      if (before.equals(after)) {
        throw new Error(
          "freebie: held ArrowLeft did not visibly move the catcher",
        );
      }
    },
    terminal: true,
  },
  frogger: {
    // OBSERVABLE input proof: the start-row strip is static (sidewalk +
    // idle hero, nothing animated there in the port) — after ArrowUp the
    // hero leaves it, so the pixels MUST change. Then keep marching
    // forward: every crossing attempt ends in a hit (3 lives) or a level
    // beat (5 levels), so the run is BOUNDED to end either way — the
    // smoke asserts `ended`, not which side of it.
    act: async (page) => {
      const surface = page.getByTestId("game-surface");
      const box = await surface.boundingBox();
      if (!box) throw new Error("frogger: no game-surface bounding box");
      // Two proof regions: the start-row hero strip AND the toast band
      // over the (static) goal art. ArrowUp either moves the hero out of
      // the strip, or walks it into the guard lane's near-center
      // instance — an instant hit that snaps the hero back but raises
      // the hit toast (which only happens because input moved the hero).
      // Either pixel change is real input proof; requiring only the
      // strip made the hit path a ~20% flake (M3 review round).
      const heroStrip = {
        x: box.x + (150 / 360) * box.width,
        y: box.y + (424 / 552) * box.height,
        width: (60 / 360) * box.width,
        height: (38 / 552) * box.height,
      };
      const toastBand = {
        x: box.x + (60 / 360) * box.width,
        y: box.y + (86 / 552) * box.height,
        width: (240 / 360) * box.width,
        height: (38 / 552) * box.height,
      };
      const heroBefore = await page.screenshot({ clip: heroStrip });
      const toastBefore = await page.screenshot({ clip: toastBand });
      await page.keyboard.press("ArrowUp");
      await page.waitForTimeout(400);
      const heroAfter = await page.screenshot({ clip: heroStrip });
      const toastAfter = await page.screenshot({ clip: toastBand });
      if (heroBefore.equals(heroAfter) && toastBefore.equals(toastAfter)) {
        throw new Error("frogger: ArrowUp had no visible effect");
      }
      const host = page.getByTestId("game-host");
      for (let i = 0; i < 130; i++) {
        if ((await host.getAttribute("data-lifecycle")) === "ended") return;
        await page.keyboard.press("ArrowUp");
        await page.waitForTimeout(400);
      }
    },
    terminal: true,
    endTimeoutMs: 60_000,
  },
};

test("every registered game has a smoke action (no silent pass for new games)", () => {
  const missing = listGames()
    .map((entry) => entry.meta.id)
    .filter((id) => !SMOKE_ACTIONS[id]);
  expect(missing).toEqual([]);
});

for (const entry of listGames()) {
  const gameId = entry.meta.id;
  const smoke = SMOKE_ACTIONS[gameId];
  if (!smoke) {
    // A new registry entry without a real-input smoke MUST fail loudly at
    // collection time, not boot-and-pass (M2 review P2).
    throw new Error(
      `no SMOKE_ACTIONS entry for "${gameId}" — add real input + a terminal expectation`,
    );
  }
  test(`${gameId}: boots, takes real input${smoke.terminal ? ", reaches the end panel" : ""}`, async ({
    page,
  }) => {
    if (smoke.endTimeoutMs) test.setTimeout(smoke.endTimeoutMs + 45_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await page.goto(`/play/${gameId}${smoke.urlQuery ?? ""}`);
    const host = page.getByTestId("game-host");
    await expect(host).toHaveAttribute("data-lifecycle", "ready", {
      timeout: 30_000,
    });
    await page.getByTestId("start-run").click();
    await expect(host).toHaveAttribute("data-lifecycle", "running");

    await smoke.act(page);
    if (smoke.terminal) {
      await expect(host).toHaveAttribute("data-lifecycle", "ended", {
        timeout: smoke.endTimeoutMs ?? 20_000,
      });
      await expect(page.getByTestId("play-again")).toBeVisible();
      // Simon 2026-07-27: every end panel — scrimmed or game-authored —
      // carries the Challenge-your-friend share CTA.
      await expect(page.getByTestId("challenge-friend")).toBeVisible();
    } else {
      await page.waitForTimeout(600);
      await expect(host).toHaveAttribute("data-lifecycle", "running");
    }
    expect(pageErrors).toEqual([]);
  });
}

test("snake: full counted loop — issue, die at 0, submit, UNPLACED receipt, board", async ({
  page,
}) => {
  test.skip(needsDb, "counted loop needs DATABASE_URL");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto("/play/snake");
  const host = page.getByTestId("game-host");
  await expect(host).toHaveAttribute("data-lifecycle", "ready", {
    timeout: 30_000,
  });
  await page.getByTestId("start-counted").click();
  await expect(host).toHaveAttribute("data-lifecycle", "running", {
    timeout: 10_000,
  });
  await page.keyboard.press("ArrowDown"); // arm (M4 start gating)
  await expect(host).toHaveAttribute("data-lifecycle", "ended", {
    timeout: 15_000,
  });
  // The reachable e2e run walks straight into a wall, so it scores 0 —
  // which by policy does NOT place (MIN_PLACING_SCORE). The run is still
  // fully counted: submitted, streak advanced, board reachable. The
  // rank branch is covered by the placing-score test below.
  const receipt = page.getByTestId("counted-result");
  await expect(receipt).toBeVisible({ timeout: 10_000 });
  await expect(receipt).toContainText("Score a point");
  await expect(receipt).not.toContainText("Rank");
  await expect(receipt).toContainText("streak");

  await receipt.getByRole("link").click();
  // DEVICE-scoped assertion only: this device's 0 gets no "your rank" row.
  // Whether the TABLE renders depends on what other devices placed this
  // ISO week (the board is shared, seasons are weekly, and the suite runs
  // in parallel) — the board-wide zero-filter is proven deterministically
  // in tests/db/counted-runs.test.ts instead.
  await expect(page).toHaveURL(/\/leaderboard\/snake/);
  await expect(page.getByText(/\d{4}-W\d{2}/)).toBeVisible({
    timeout: 10_000,
  }); // board loaded to its ready state
  await expect(page.getByTestId("board-me")).toBeHidden();
  expect(pageErrors).toEqual([]);
});

test("snake: a PLACING score renders the rank receipt and puts you on the board", async ({
  page,
}) => {
  test.skip(needsDb, "counted loop needs DATABASE_URL");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  // Driving the snake to a real gift needs the seeded food position, which
  // a counted run does not expose. Rewrite the submitted SCORE on the wire
  // instead: the server still ranks it, writes the board row, and returns
  // the receipt — only the number the game reported is substituted.
  await page.route("**/api/runs/*", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const sent = JSON.parse(route.request().postData() ?? "{}") as {
      score: number;
    };
    await route.continue({
      postData: JSON.stringify({ ...sent, score: 120 }),
    });
  });

  await page.goto("/play/snake");
  const host = page.getByTestId("game-host");
  await expect(host).toHaveAttribute("data-lifecycle", "ready", {
    timeout: 30_000,
  });
  await page.getByTestId("start-counted").click();
  await expect(host).toHaveAttribute("data-lifecycle", "running", {
    timeout: 10_000,
  });
  await page.keyboard.press("ArrowDown");
  await expect(host).toHaveAttribute("data-lifecycle", "ended", {
    timeout: 15_000,
  });

  const receipt = page.getByTestId("counted-result");
  await expect(receipt).toBeVisible({ timeout: 10_000 });
  await expect(receipt).toContainText("Rank #");

  await receipt.getByRole("link").click();
  await expect(page.getByTestId("board-me")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("board-table")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

async function flappyCashOut(page: Page): Promise<void> {
  const surface = page.getByTestId("game-surface");
  const box = await surface.boundingBox();
  if (!box) throw new Error("flappy: no game-surface bounding box");
  const scale = box.height / 640;
  const originX = box.x + box.width / 2 - (360 * scale) / 2;
  const tap = async (dx: number, dy: number) =>
    page.mouse.click(originX + dx * scale, box.y + dy * scale);
  await tap(80, 400); // flap — arms the run
  await page.waitForTimeout(250);
  await tap(360 - 84 + 36, 12 + 27); // ⏹ leave
  await page.waitForTimeout(250);
  await tap(180, 430); // LEAVE & SAVE
}

test("flappy: counted cash-out shows the receipt ON the game-authored end (review P1)", async ({
  page,
}) => {
  test.skip(needsDb, "counted loop needs DATABASE_URL");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto("/play/flappy");
  const host = page.getByTestId("game-host");
  await expect(host).toHaveAttribute("data-lifecycle", "ready", {
    timeout: 30_000,
  });
  await page.getByTestId("start-counted").click();
  await expect(host).toHaveAttribute("data-lifecycle", "running", {
    timeout: 10_000,
  });
  await flappyCashOut(page);
  await expect(host).toHaveAttribute("data-lifecycle", "ended", {
    timeout: 15_000,
  });
  // The authored end must still surface the counted receipt — it was
  // previously host-overlay-only, so a counted cash-out committed
  // invisibly.
  const receipt = page.getByTestId("counted-result");
  await expect(receipt).toBeVisible({ timeout: 10_000 });
  await expect(receipt).toContainText("streak");
  await expect(page.getByTestId("play-again")).toBeVisible();
  await expect(page.getByTestId("challenge-friend")).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test("flappy: Play Again is DISABLED while the counted save is in flight (audit P1)", async ({
  page,
}) => {
  test.skip(needsDb, "counted loop needs DATABASE_URL");
  // Hold the PUT open long enough to observe the guard, then let it land.
  await page.route("**/api/runs/*", async (route) => {
    if (route.request().method() === "PUT") {
      await new Promise((resolve) => setTimeout(resolve, 2500));
    }
    await route.continue();
  });
  await page.goto("/play/flappy");
  const host = page.getByTestId("game-host");
  await expect(host).toHaveAttribute("data-lifecycle", "ready", {
    timeout: 30_000,
  });
  await page.getByTestId("start-counted").click();
  await expect(host).toHaveAttribute("data-lifecycle", "running", {
    timeout: 10_000,
  });
  await flappyCashOut(page);
  await expect(host).toHaveAttribute("data-lifecycle", "ended", {
    timeout: 15_000,
  });
  // While the PUT is pending, a fast tap must NOT be able to start
  // Practice and hide the receipt (the M2 save race, re-fixed for the
  // game-authored branch).
  await expect(page.getByTestId("play-again")).toBeDisabled();
  await expect(page.getByTestId("counted-result")).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByTestId("play-again")).toBeEnabled();
});

test("flappy: lost PUT on a counted cash-out shows Retry save on the authored end (review P1)", async ({
  page,
}) => {
  test.skip(needsDb, "counted loop needs DATABASE_URL");
  await page.route("**/api/runs/*", async (route) => {
    if (route.request().method() === "PUT") {
      await route.fetch(); // server commits; the response is lost
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.goto("/play/flappy");
  const host = page.getByTestId("game-host");
  await expect(host).toHaveAttribute("data-lifecycle", "ready", {
    timeout: 30_000,
  });
  await page.getByTestId("start-counted").click();
  await expect(host).toHaveAttribute("data-lifecycle", "running", {
    timeout: 10_000,
  });
  await flappyCashOut(page);
  await expect(host).toHaveAttribute("data-lifecycle", "ended", {
    timeout: 15_000,
  });
  // Failure must be VISIBLE on the authored end, with the retry path.
  const retry = page.getByTestId("retry-save");
  await expect(retry).toBeVisible({ timeout: 10_000 });
  await page.unroute("**/api/runs/*");
  await retry.click();
  await expect(page.getByTestId("counted-result")).toBeVisible({
    timeout: 10_000,
  });
});

test("claw: GAME-OWNED counted loop — issue, drop, committed end, receipt", async ({
  page,
}) => {
  test.skip(needsDb, "counted loop needs DATABASE_URL");
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto("/play/claw");
  const host = page.getByTestId("game-host");
  await expect(host).toHaveAttribute("data-lifecycle", "ready", {
    timeout: 30_000,
  });
  await page.getByTestId("start-counted").click();
  await expect(host).toHaveAttribute("data-lifecycle", "running", {
    timeout: 10_000,
  });

  // Space = drop → server-committed outcome → animation → game-owned end.
  await page.keyboard.press("Space");
  await expect(host).toHaveAttribute("data-lifecycle", "ended", {
    timeout: 20_000,
  });
  const receipt = page.getByTestId("counted-result");
  await expect(receipt).toBeVisible({ timeout: 10_000 });
  await expect(receipt).toContainText("saved");
  expect(pageErrors).toEqual([]);
});

test("thisorthat: host Play Again restarts the authored-end game (M4.5 review P2)", async ({
  page,
}) => {
  await page.goto("/play/thisorthat");
  const host = page.getByTestId("game-host");
  await expect(host).toHaveAttribute("data-lifecycle", "ready", {
    timeout: 30_000,
  });
  await page.getByTestId("start-run").click();
  for (let i = 0; i < 9; i++) {
    await page.getByTestId(`tot-card-${i % 2}`).click();
    await page.waitForTimeout(340);
  }
  await expect(host).toHaveAttribute("data-lifecycle", "ended");
  await expect(page.getByTestId("tot-result")).toBeVisible(); // no overlay
  await page.getByTestId("play-again").click();
  await expect(host).toHaveAttribute("data-lifecycle", "running");
  await expect(page.getByTestId("tot-progress")).toHaveText("1 / 9");
});

test("fresh es device: home load fires EXACTLY ONE session bootstrap, already es-419 (M4 review P1)", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ locale: "es-MX" });
  const page = await context.newPage();
  const sessionBodies: string[] = [];
  await page.route("**/api/session", async (route) => {
    sessionBodies.push(route.request().postData() ?? "");
    await route.continue();
  });
  await page.goto(`${baseURL}/`);
  // Streak strip settles (or stays hidden) once the bootstrap resolves.
  await page.waitForTimeout(1500);
  // ONE request, ALREADY carrying the resolved locale — the duplicate
  // cookie-less en/es pair created two device identities before.
  expect(sessionBodies).toHaveLength(1);
  expect(JSON.parse(sessionBodies[0]).locale).toBe("es-419");
  await context.close();
});

test("es device: direct game route is fully Spanish — text, ARIA, lang — with NO hydration errors (M4 review P1)", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ locale: "es-MX" });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(`${baseURL}/play/snake`);
  await expect(page.getByTestId("game-host")).toHaveAttribute(
    "data-lifecycle",
    "ready",
    { timeout: 30_000 },
  );
  await expect(page.locator("html")).toHaveAttribute("lang", "es-419");
  await expect(page.getByTestId("start-run")).toContainText("Práctica");
  // ATTRIBUTES must localize too — the old client-init approach left
  // hydration-mismatched English aria labels behind.
  await expect(
    page.getByRole("link", { name: "Volver a Aegyo Arena" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Silenciar" })).toBeVisible();
  expect(consoleErrors.filter((text) => /hydrat/i.test(text))).toEqual([]);
  await context.close();
});

test("lost PUT response → same-attempt Retry save → receipt (§10.1)", async ({
  page,
}) => {
  test.skip(needsDb, "counted loop needs DATABASE_URL");
  const putBodies: string[] = [];
  let firstPutStatus: number | null = null;
  await page.route("**/api/runs/*", async (route) => {
    if (route.request().method() === "PUT") {
      putBodies.push(route.request().postData() ?? "");
      if (putBodies.length === 1) {
        // Let the server COMMIT — and capture the proof — then lose the
        // response on the wire (M2 review P2: the successful commit must
        // be evidenced, not assumed).
        const committed = await route.fetch();
        firstPutStatus = committed.status();
        await route.abort();
        return;
      }
    }
    await route.continue();
  });

  await page.goto("/play/snake");
  const host = page.getByTestId("game-host");
  await expect(host).toHaveAttribute("data-lifecycle", "ready", {
    timeout: 30_000,
  });
  await page.getByTestId("start-counted").click();
  await expect(host).toHaveAttribute("data-lifecycle", "running", {
    timeout: 10_000,
  });
  await page.keyboard.press("ArrowDown"); // arm (M4 start gating)
  await expect(host).toHaveAttribute("data-lifecycle", "ended", {
    timeout: 20_000,
  });

  // Submission failed → retry is offered with the SAME attempt/payload.
  const retry = page.getByTestId("retry-save");
  await expect(retry).toBeVisible({ timeout: 10_000 });
  const retryResponsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/runs/") && r.request().method() === "PUT",
  );
  await retry.click();

  // The server already committed: the retry replays the ORIGINAL receipt.
  // This run dies at 0, so that receipt is the unplaced one — what matters
  // here is that a receipt is replayed at all, byte-identically.
  const receipt = page.getByTestId("counted-result");
  await expect(receipt).toBeVisible({ timeout: 10_000 });
  await expect(receipt).toContainText("streak");

  // Evidence, not inference (M2 review P2): the first PUT committed, the
  // retry re-sent a byte-identical payload, and the server marked its
  // response as a replay of the original result.
  expect(firstPutStatus).toBe(200);
  expect(putBodies).toHaveLength(2);
  expect(putBodies[1]).toBe(putBodies[0]);
  const retryResponse = await retryResponsePromise;
  expect(retryResponse.status()).toBe(200);
  const retryBody = (await retryResponse.json()) as { replay?: boolean };
  expect(retryBody.replay).toBe(true);
});
