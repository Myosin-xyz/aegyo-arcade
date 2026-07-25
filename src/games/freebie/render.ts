/**
 * Freebie Frenzy renderer — pure draw over FreebieState. The background
 * art has the SCORE/LEVEL/hearts HUD chrome baked in (delivery parity),
 * so this only draws the values at the baked box positions, plus
 * sprites, popups, callouts, and the in-canvas recap overlay.
 */

import {
  CATCH_TOLERANCE,
  CATCH_Y,
  DESIGN_H,
  DESIGN_W,
  GROUND_Y,
  HERO_H,
  HERO_W,
  LIVES_PER_LEVEL,
  MISS_FLASH_SEC,
  POPUP_TTL,
  TOTAL_LEVELS,
  fanRank,
  fitFontPx,
  freebieDrawX,
  type FreebieState,
} from "./logic";

export interface FreebieImages {
  bg: HTMLImageElement;
  hero: HTMLImageElement;
  tiers: HTMLImageElement[]; // index = tier
}

// Baked HUD box centers, measured from the delivery's CSS percentages.
const HUD_Y = (0.1242 + 0.0491 / 2) * DESIGN_H;
const SCORE_X = (0.2232 + 0.1736 / 2 + 0.028) * DESIGN_W; // after "SCORE:"
const LEVEL_X = (0.5562 + 0.0974 / 2 + 0.018) * DESIGN_W; // after "LEVEL:"
const HEARTS_X = (0.6816 + 0.2287 / 2) * DESIGN_W;
export const SCORE_BASE_PX = 17;
export const SCORE_MIN_PX = 9;
// Room from the score's left edge to the score pill's right edge — the
// value shrinks to fit here so 4-digit scores (up to 2277) can't spill
// past the frame (Daidai). Exported so a real-metrics test can prove
// containment in an actual Chromium canvas.
export const SCORE_MAX_W = (0.2232 + 0.1736) * DESIGN_W - SCORE_X - 3;

type Translate = (key: string, params?: Record<string, string>) => string;

/**
 * Largest font (down to SCORE_MIN_PX) at which the score string fits
 * SCORE_MAX_W: fitFontPx seeds the size analytically, then we remeasure
 * and step down because real font metrics don't scale perfectly linearly
 * (the seed can overshoot by a fraction of a pixel). jsdom returns no
 * metrics — the guard falls back to the base size and never loops.
 */
function fitScoreSize(g: CanvasRenderingContext2D, s: string): number {
  g.font = `700 ${SCORE_BASE_PX}px system-ui, sans-serif`;
  const w0 = (g.measureText(s) as TextMetrics | undefined)?.width ?? 0;
  let size = fitFontPx(w0, SCORE_MAX_W, SCORE_BASE_PX, SCORE_MIN_PX);
  while (size > SCORE_MIN_PX) {
    g.font = `700 ${size}px system-ui, sans-serif`;
    const w = (g.measureText(s) as TextMetrics | undefined)?.width ?? 0;
    if (w <= 0 || w <= SCORE_MAX_W) break;
    size -= 1;
  }
  return size;
}

function drawHeart(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  filled: boolean,
): void {
  g.beginPath();
  g.moveTo(x, y + r);
  g.bezierCurveTo(
    x - r * 1.4,
    y - r * 0.3,
    x - r * 0.7,
    y - r * 1.2,
    x,
    y - r * 0.4,
  );
  g.bezierCurveTo(x + r * 0.7, y - r * 1.2, x + r * 1.4, y - r * 0.3, x, y + r);
  g.closePath();
  if (filled) {
    g.fillStyle = "#ff4f8b";
    g.fill();
  } else {
    g.strokeStyle = "rgba(255,255,255,0.5)";
    g.lineWidth = 2;
    g.stroke();
  }
}

export function renderFreebie(
  g: CanvasRenderingContext2D,
  state: FreebieState,
  images: FreebieImages,
  t: Translate,
): void {
  g.clearRect(0, 0, DESIGN_W, DESIGN_H);
  g.drawImage(images.bg, 0, 0, DESIGN_W, DESIGN_H);

  // Freebies (wobble-displaced X is the collision X too).
  for (const f of state.freebies) {
    const img = images.tiers[f.tier];
    const w = f.size;
    const h = (f.size * img.naturalHeight) / img.naturalWidth || f.size;
    g.save();
    g.translate(freebieDrawX(f), f.y);
    g.rotate(Math.sin(f.rot) * 0.35);
    g.drawImage(img, -w / 2, -h / 2, w, h);
    g.restore();
  }

  // Catcher: bottom-anchored at the ground line, subtle bob + catch hop.
  const c = state.catcher;
  const bobY = Math.sin(c.bob) * 2 - c.glow * 8;
  g.save();
  if (c.glow > 0) {
    g.shadowColor = "rgba(255, 224, 102, 0.9)";
    g.shadowBlur = 18 * c.glow;
  }
  g.drawImage(
    images.hero,
    c.x - HERO_W / 2,
    GROUND_Y - HERO_H + bobY,
    HERO_W,
    HERO_H,
  );
  g.restore();

  // Red damage flash on a missed catch (Daidai): full-field tint over the
  // play area, under the HUD, fading with state.missFlash.
  if (state.missFlash > 0) {
    g.save();
    g.globalAlpha = 0.3 * (state.missFlash / MISS_FLASH_SEC);
    g.fillStyle = "#ff2a3c";
    g.fillRect(0, 0, DESIGN_W, DESIGN_H);
    g.restore();
  }

  // HUD values over the baked chrome.
  g.textBaseline = "middle";
  g.fillStyle = "#f4ecff";
  g.textAlign = "left";
  // Score shrinks to stay inside its baked pill regardless of digit
  // count (Daidai overflow fix). fitFontPx gives a fast analytic seed,
  // but real font metrics aren't perfectly linear with size, so remeasure
  // and step down until it truly fits (down to 9px). fillText's maxWidth
  // is the spec-guaranteed final clamp for the min-size edge.
  const scoreStr = String(state.score);
  const scoreSize = fitScoreSize(g, scoreStr);
  g.font = `700 ${scoreSize}px system-ui, sans-serif`;
  g.fillText(scoreStr, SCORE_X, HUD_Y, SCORE_MAX_W);
  g.font = "700 17px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText(String(state.level), LEVEL_X, HUD_Y);
  for (let i = 0; i < LIVES_PER_LEVEL; i++) {
    drawHeart(g, HEARTS_X + (i - 1) * 26, HUD_Y, 8, i < state.lives);
  }

  // Combo tag (delivery shows it from combo 3).
  if (state.combo >= 3 && state.status === "playing") {
    g.font = "700 14px system-ui, sans-serif";
    g.fillStyle = "#ffe066";
    g.fillText(
      t("game.freebie.combo", { count: String(state.combo) }),
      DESIGN_W / 2,
      HUD_Y + 34,
    );
  }

  // Score popups + a burst of 4-point sparkles while they are fresh.
  g.font = "800 18px system-ui, sans-serif";
  for (const p of state.popups) {
    const life = 1 - p.age / POPUP_TTL;
    g.globalAlpha = Math.max(0, life);
    g.fillStyle = "#ffffff";
    g.fillText(p.text, p.x, p.y - (1 - life) * 46);
    if (p.age < 0.35) {
      const burst = p.age / 0.35;
      g.fillStyle = "#ffe066";
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2 + p.x * 0.13;
        const dist = 10 + burst * 26;
        const sx = p.x + Math.cos(angle) * dist;
        const sy = p.y + Math.sin(angle) * dist * 0.7;
        const r = 3.2 * (1 - burst);
        g.globalAlpha = (1 - burst) * 0.9;
        g.beginPath();
        g.moveTo(sx, sy - r);
        g.lineTo(sx + r * 0.35, sy - r * 0.35);
        g.lineTo(sx + r, sy);
        g.lineTo(sx + r * 0.35, sy + r * 0.35);
        g.lineTo(sx, sy + r);
        g.lineTo(sx - r * 0.35, sy + r * 0.35);
        g.lineTo(sx - r, sy);
        g.lineTo(sx - r * 0.35, sy - r * 0.35);
        g.closePath();
        g.fill();
      }
    }
  }
  g.globalAlpha = 1;

  // Catch callout.
  if (state.callout) {
    g.font = "800 22px system-ui, sans-serif";
    g.fillStyle = state.callout.kind === "jackpot" ? "#ffe066" : "#7dffd9";
    g.fillText(
      t(`game.freebie.callout.${state.callout.kind}.${state.callout.variant}`),
      DESIGN_W / 2,
      CATCH_Y - CATCH_TOLERANCE - 40,
    );
  }

  // Recap overlay (in-run level break; the host owns the final panel).
  if (state.status === "recap") drawRecap(g, state, t);
}

/** Rounded-rect path (guarded — jsdom's stub context lacks roundRect;
 * recap only draws in a real browser, but stay defensive). */
function roundRectPath(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  if (typeof g.roundRect === "function") {
    g.roundRect(x, y, w, h, r);
  } else {
    g.rect(x, y, w, h);
  }
}

/**
 * Richer in-run level recap (Daidai: the plain block was flatter than
 * the original). Badge, playful headline, clean-clear bonus, fan-rank
 * pill, Level-score / Total stat cards, per-level progress dots, and a
 * prominent Continue button. Still in-canvas and tap-to-continue — the
 * whole overlay advances the run, no lifecycle change.
 */
function drawRecap(
  g: CanvasRenderingContext2D,
  state: FreebieState,
  t: Translate,
): void {
  const cx = DESIGN_W / 2;
  const clean = state.lives === LIVES_PER_LEVEL;
  const next = state.level + 1;

  g.fillStyle = "rgba(12, 4, 28, 0.9)";
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);
  g.textAlign = "center";
  g.textBaseline = "middle";

  // Badge pill.
  roundRectPath(g, cx - 100, DESIGN_H * 0.2, 200, 30, 15);
  g.fillStyle = "#ffd166";
  g.fill();
  g.fillStyle = "#2a0713";
  g.font = "800 13px system-ui, sans-serif";
  g.fillText(
    t("game.freebie.recap.badge", { level: String(state.level) }).toUpperCase(),
    cx,
    DESIGN_H * 0.2 + 15,
  );

  // Playful headline.
  g.fillStyle = "#ffffff";
  g.font = "800 26px system-ui, sans-serif";
  g.fillText(
    t(
      clean
        ? "game.freebie.recap.headlineClean"
        : "game.freebie.recap.headline",
    ),
    cx,
    DESIGN_H * 0.28,
  );

  // Clean-clear bonus (only when one was awarded).
  if (state.lastBonus > 0) {
    g.fillStyle = "#ffe066";
    g.font = "600 15px system-ui, sans-serif";
    g.fillText(
      t("game.freebie.recap.bonus", { bonus: String(state.lastBonus) }),
      cx,
      DESIGN_H * 0.28 + 30,
    );
  }

  // Fan-rank pill.
  roundRectPath(g, cx - 120, DESIGN_H * 0.38, 240, 36, 18);
  g.fillStyle = "rgba(255, 143, 184, 0.16)";
  g.fill();
  g.fillStyle = "#ff8fb8";
  g.font = "700 15px system-ui, sans-serif";
  g.fillText(
    t(`game.freebie.rank.${fanRank(state.score)}`),
    cx,
    DESIGN_H * 0.38 + 18,
  );

  // Stat cards: Level score (+bonus) and Total.
  const cardW = 150;
  const cardH = 66;
  const cardY = DESIGN_H * 0.48;
  const gap = 16;
  const leftX = cx - cardW - gap / 2;
  const rightX = cx + gap / 2;
  const levelValue =
    state.lastBonus > 0
      ? `${state.levelScore} (+${state.lastBonus})`
      : String(state.levelScore);
  for (const [x, label, value] of [
    [leftX, t("game.freebie.recap.levelScoreLabel"), levelValue],
    [rightX, t("game.freebie.recap.totalLabel"), String(state.score)],
  ] as const) {
    roundRectPath(g, x, cardY, cardW, cardH, 12);
    g.fillStyle = "rgba(43, 17, 70, 0.85)";
    g.fill();
    g.fillStyle = "#b9a8e0";
    g.font = "700 11px system-ui, sans-serif";
    g.fillText(label.toUpperCase(), x + cardW / 2, cardY + 20);
    g.fillStyle = "#ffffff";
    g.font = "800 20px system-ui, sans-serif";
    g.fillText(value, x + cardW / 2, cardY + 44);
  }

  // Per-level progress dots.
  const dotY = DESIGN_H * 0.64;
  const dotGap = 22;
  const dotsW = (TOTAL_LEVELS - 1) * dotGap;
  for (let i = 1; i <= TOTAL_LEVELS; i++) {
    const dx = cx - dotsW / 2 + (i - 1) * dotGap;
    g.beginPath();
    g.arc(dx, dotY, i === state.level ? 6 : 4, 0, Math.PI * 2);
    g.fillStyle =
      i === state.level ? "#ff4f8b" : i < state.level ? "#ffd166" : "#4a3866";
    g.fill();
  }

  // Prominent Continue button (tap anywhere advances — this is the cue).
  const btnW = 260;
  const btnH = 52;
  const btnX = cx - btnW / 2;
  const btnY = DESIGN_H * 0.72;
  roundRectPath(g, btnX, btnY, btnW, btnH, 14);
  g.fillStyle = "#ffd166";
  g.fill();
  g.fillStyle = "#2a0713";
  g.font = "800 17px system-ui, sans-serif";
  g.fillText(
    t("game.freebie.recap.continueTo", { level: String(next) }),
    cx,
    btnY + btnH / 2,
  );
}
