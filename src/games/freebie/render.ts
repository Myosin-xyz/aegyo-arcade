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
  POPUP_TTL,
  fanRank,
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

type Translate = (key: string, params?: Record<string, string>) => string;

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

  // HUD values over the baked chrome.
  g.textBaseline = "middle";
  g.fillStyle = "#f4ecff";
  g.font = "700 17px system-ui, sans-serif";
  g.textAlign = "left";
  g.fillText(String(state.score), SCORE_X, HUD_Y);
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
  if (state.status === "recap") {
    g.fillStyle = "rgba(12, 4, 28, 0.82)";
    g.fillRect(0, 0, DESIGN_W, DESIGN_H);
    g.fillStyle = "#ffffff";
    g.textAlign = "center";
    g.font = "800 26px system-ui, sans-serif";
    g.fillText(
      t("game.freebie.recap.cleared", { level: String(state.level) }),
      DESIGN_W / 2,
      DESIGN_H * 0.36,
    );
    g.font = "600 17px system-ui, sans-serif";
    g.fillStyle = "#ffe066";
    g.fillText(
      t("game.freebie.recap.bonus", { bonus: String(state.lastBonus) }),
      DESIGN_W / 2,
      DESIGN_H * 0.36 + 36,
    );
    g.fillStyle = "#f4ecff";
    g.fillText(
      t("game.freebie.recap.total", { score: String(state.score) }),
      DESIGN_W / 2,
      DESIGN_H * 0.36 + 64,
    );
    g.fillStyle = "#b9a8e0";
    g.fillText(
      t(`game.freebie.rank.${fanRank(state.score)}`),
      DESIGN_W / 2,
      DESIGN_H * 0.36 + 92,
    );
    g.font = "700 16px system-ui, sans-serif";
    g.fillStyle = "#7dffd9";
    g.fillText(
      t("game.freebie.recap.continue"),
      DESIGN_W / 2,
      DESIGN_H * 0.36 + 140,
    );
  }
}
