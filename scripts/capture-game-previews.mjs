#!/usr/bin/env node

/**
 * Capture deterministic, localized three-second landing-card previews from
 * the shipped games themselves.
 *
 * Usage (requires the app and ffmpeg):
 *   npm run dev
 *   node scripts/capture-game-previews.mjs
 *   node scripts/capture-game-previews.mjs claw hangman
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { chromium } from "@playwright/test";

const execFileAsync = promisify(execFile);
const BASE_URL = process.env.PREVIEW_BASE_URL ?? "http://localhost:3000";
const FPS = 15;
const FRAME_COUNT = FPS * 3;
const LOCALES = ["en", "es-419"];
const OUTPUT_SIZE = 360;

const previewConfigs = {
  claw: {
    cropY: 0,
    seed: "claw-preview-v1",
    posterFrame: 24,
    onFrame: async ({ frame, page, surface }) => {
      if (frame === 3) await surface.focus();
      if (frame === 5) await page.keyboard.press("Space");
    },
  },
  snake: {
    cropY: 0,
    seed: "snake-preview-v1",
    posterFrame: 25,
    onFrame: async ({ frame, page, surface }) => {
      if (frame === 1) {
        await surface.focus();
        await page.keyboard.press("ArrowUp");
      }
      if (frame === 18) await page.keyboard.press("ArrowRight");
      if (frame === 34) await page.keyboard.press("ArrowDown");
    },
  },
  flappy: {
    cropY: 0,
    seed: "flappy-preview-v1",
    posterFrame: 16,
    onFrame: async ({ frame, page, surface }) => {
      if (frame === 1) await surface.focus();
      if ([2, 14, 26, 38].includes(frame)) {
        await page.keyboard.press("Space");
      }
    },
  },
  jumper: {
    cropY: 110,
    seed: "jumper-preview-v1",
    posterFrame: 5,
    onFrame: async ({ frame, page, surface }) => {
      if (frame === 1) {
        await surface.focus();
        await page.keyboard.down("ArrowLeft");
      }
      if (frame === 13) {
        await page.keyboard.up("ArrowLeft");
        await page.keyboard.down("ArrowRight");
      }
      if (frame === 29) await page.keyboard.up("ArrowRight");
    },
  },
  hangman: {
    cropY: 0,
    seed: "hangman-preview-v1",
    posterFrame: 31,
    onFrame: async ({ frame, page }) => {
      const guesses = new Map([
        [6, "A"],
        [17, "E"],
        [28, "B"],
        [39, "K"],
      ]);
      const letter = guesses.get(frame);
      if (letter) {
        await page.locator(`button[data-letter="${letter}"]`).click();
      }
    },
  },
  freebie: {
    cropY: 0,
    seed: "freebie-preview-v1",
    preCaptureMs: 1150,
    posterFrame: 29,
    onFrame: async ({ frame, page, surface }) => {
      if (frame === 1) {
        await surface.focus();
        await page.keyboard.down("ArrowLeft");
      }
      if (frame === 13) {
        await page.keyboard.up("ArrowLeft");
        await page.keyboard.down("ArrowRight");
      }
      if (frame === 32) await page.keyboard.up("ArrowRight");
    },
  },
  frogger: {
    cropY: 0,
    seed: "frogger-preview-v1",
    posterFrame: 25,
    onFrame: async ({ frame, page, surface }) => {
      if (frame === 1) await surface.focus();
      if ([4, 13, 22, 31, 40].includes(frame)) {
        await page.keyboard.press("ArrowUp");
      }
    },
  },
  thisorthat: {
    cropY: 0,
    seed: "this-or-that-preview-v1",
    posterFrame: 32,
    onFrame: async ({ frame, page }) => {
      if ([7, 19, 31, 42].includes(frame)) {
        await page.locator("button[data-side]").first().click();
      }
    },
  },
};

const selectedGames = process.argv.slice(2);
const games = selectedGames.length
  ? selectedGames
  : Object.keys(previewConfigs);

for (const game of games) {
  if (!previewConfigs[game]) {
    throw new Error(`Unknown game \"${game}\"`);
  }
}

function framePath(directory, frame) {
  return join(directory, `frame-${String(frame).padStart(3, "0")}.png`);
}

async function encodePreview({ directory, game, locale, posterFrame }) {
  const suffix = locale === "en" ? "en" : "es-419";
  const outputBase = join("public", "games", game, `preview-v1-${suffix}`);
  await mkdir(dirname(outputBase), { recursive: true });

  await execFileAsync("ffmpeg", [
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-framerate",
    String(FPS),
    "-i",
    join(directory, "frame-%03d.png"),
    "-t",
    "3",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "35",
    "-maxrate",
    "90k",
    "-bufsize",
    "180k",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    `${outputBase}.mp4`,
  ]);

  await execFileAsync("ffmpeg", [
    "-nostdin",
    "-v",
    "error",
    "-y",
    "-i",
    framePath(directory, posterFrame),
    "-frames:v",
    "1",
    "-c:v",
    "libwebp",
    "-quality",
    "74",
    `${outputBase}.webp`,
  ]);
}

async function capturePreview(browser, game, locale) {
  const config = previewConfigs[game];
  const directory = await mkdtemp(join(tmpdir(), `aegyo-${game}-${locale}-`));
  const context = await browser.newContext({
    viewport: { width: OUTPUT_SIZE, height: 720 },
    deviceScaleFactor: 1,
    locale: locale === "en" ? "en-US" : "es-419",
    reducedMotion: "no-preference",
  });
  const page = await context.newPage();
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key, value),
    ["aa-locale", locale],
  );

  try {
    await page.goto(
      `${BASE_URL}/play/${game}?seed=${encodeURIComponent(config.seed)}`,
      { waitUntil: "networkidle" },
    );
    await page.locator('[data-testid="game-host"]').waitFor();
    await page.locator('[data-testid="start-run"]').click();
    await page
      .locator('[data-testid="game-host"][data-lifecycle="running"]')
      .waitFor();
    await page.evaluate(() => {
      document.querySelector("nextjs-portal")?.remove();
      document.documentElement.style.overflow = "hidden";
    });
    if (config.preCaptureMs) await page.waitForTimeout(config.preCaptureMs);

    const surface = page.locator('[data-testid="game-surface"]');
    const frame = page.locator('[data-testid="game-surface-frame"]');
    const box = await frame.boundingBox();
    if (!box) throw new Error(`No surface frame for ${game}`);

    const clip = {
      x: Math.round(box.x + (box.width - OUTPUT_SIZE) / 2),
      y: Math.round(box.y + (config.cropY ?? 0)),
      width: OUTPUT_SIZE,
      height: OUTPUT_SIZE,
    };
    const startedAt = Date.now();
    for (let frameIndex = 0; frameIndex < FRAME_COUNT; frameIndex += 1) {
      await config.onFrame({ frame: frameIndex, page, surface });
      const targetTime = startedAt + (frameIndex * 1000) / FPS;
      const delay = targetTime - Date.now();
      if (delay > 0) await page.waitForTimeout(delay);
      await page.screenshot({
        path: framePath(directory, frameIndex),
        clip,
        animations: "allow",
      });
    }

    await encodePreview({
      directory,
      game,
      locale,
      posterFrame: config.posterFrame,
    });
    console.log(`captured ${game} (${locale})`);
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
}

const browser = await chromium.launch({ headless: true });
try {
  for (const game of games) {
    for (const locale of LOCALES) {
      await capturePreview(browser, game, locale);
    }
  }
} finally {
  await browser.close();
}
