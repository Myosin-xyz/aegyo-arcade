/**
 * Cross to the Concert renderer — pure draw over FroggerState. The
 * background art bakes in the HUD chrome (SCORE/LEVEL/BEST boxes + timer
 * box); values are drawn at the baked positions. Bollards draw FRONTMOST
 * (delivery parity — decorative, no collision). Exact HUD value
 * placement is booked for the post-reskin visual QA pass
 * (docs/CONTENT_REGISTER.md).
 */

import {
  BAR_H,
  GAME_H,
  GAME_W,
  HERO_TARGET_H,
  HERO_X,
  LIVES,
  formatTime,
  laneDrawWidth,
  rowCenterY,
  type FroggerState,
  type LaneKey,
} from "./logic";

export interface FroggerImages {
  bg: HTMLImageElement;
  controls: HTMLImageElement;
  hero: HTMLImageElement;
  checkpoint: HTMLImageElement;
  denied: HTMLImageElement;
  congrats: HTMLImageElement;
  bollards: HTMLImageElement;
  lanes: Record<LaneKey, HTMLImageElement>;
}

/**
 * Sprites drawn facing LEFT natively; flip when travelling L→R. Values
 * are the delivery's own FACING_LEFT_BY_KEY verbatim — the scalper is
 * native-facing RIGHT (flipping it mirrors the "BEST TICKETS" sign;
 * M3 review P2).
 */
const FACES_LEFT: Record<LaneKey, boolean> = {
  golf: true,
  merch: true,
  scalper: false,
  kfood: true,
  guard: false,
};

// Bollard composite: hard-coded PSD bbox (1024-wide) × design scale.
const PSD_SCALE = GAME_W / 1024;
const BOLLARDS = {
  x: 224 * PSD_SCALE,
  y: 542 * PSD_SCALE,
  w: 529 * PSD_SCALE,
  h: 488 * PSD_SCALE,
};

// Baked HUD box anchors (estimated from the background art).
const HUD_Y = 42;
const SCORE_X = 140;
const LEVEL_X = 202;
const BEST_X = 268;
const TIMER_X = 322;

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
    g.strokeStyle = "rgba(255,255,255,0.45)";
    g.lineWidth = 1.5;
    g.stroke();
  }
}

export function renderFrogger(
  g: CanvasRenderingContext2D,
  state: FroggerState,
  images: FroggerImages,
  t: Translate,
): void {
  g.clearRect(0, 0, GAME_W, GAME_H + BAR_H);
  g.drawImage(images.bg, 0, 0, GAME_W, GAME_H);

  // Obstacles, each grounded by a soft shadow (style pass — the flat
  // lane art reads floaty without contact shadows).
  for (let laneIdx = 0; laneIdx < state.lanes.length; laneIdx++) {
    const lane = state.lanes[laneIdx];
    const img = images.lanes[lane.spec.key];
    const w = laneDrawWidth(lane.spec);
    const h = lane.spec.targetH;
    const cy = rowCenterY(laneIdx + 1);
    const flip = lane.spec.dir === 1 && FACES_LEFT[lane.spec.key];
    g.fillStyle = "rgba(6, 2, 14, 0.35)";
    for (const x of lane.xs) {
      g.beginPath();
      g.ellipse(x, cy + h / 2 - 1, w * 0.42, h * 0.14, 0, 0, Math.PI * 2);
      g.fill();
    }
    for (const x of lane.xs) {
      g.save();
      g.translate(x, cy);
      if (flip) g.scale(-1, 1);
      g.drawImage(img, -w / 2, -h / 2, w, h);
      g.restore();
    }
  }

  // Hero: fixed x, snapped row, cosmetic move bounce, invuln blink.
  const blinkHidden =
    state.invuln > 0 && Math.floor(state.invuln / 5) % 2 === 0;
  if (!blinkHidden && state.status !== "won") {
    g.fillStyle = "rgba(6, 2, 14, 0.4)";
    g.beginPath();
    g.ellipse(
      HERO_X,
      rowCenterY(state.row) + HERO_TARGET_H / 2 - 1,
      HERO_TARGET_H * 0.45,
      HERO_TARGET_H * 0.12,
      0,
      0,
      Math.PI * 2,
    );
    g.fill();
    const heroW =
      (HERO_TARGET_H * images.hero.naturalWidth) / images.hero.naturalHeight ||
      HERO_TARGET_H;
    const bounce = state.anim * 6;
    g.drawImage(
      images.hero,
      HERO_X - heroW / 2,
      rowCenterY(state.row) - HERO_TARGET_H / 2 - bounce,
      heroW,
      HERO_TARGET_H,
    );
  }

  // Bollards draw FRONTMOST (delivery layer order; no collision).
  g.drawImage(images.bollards, BOLLARDS.x, BOLLARDS.y, BOLLARDS.w, BOLLARDS.h);

  // HUD values over the baked chrome.
  g.textBaseline = "middle";
  g.fillStyle = "#f4ecff";
  g.font = "700 11px Inter, system-ui, sans-serif";
  g.textAlign = "right";
  g.fillText(String(state.score), SCORE_X, HUD_Y);
  g.fillText(String(state.level), LEVEL_X, HUD_Y);
  g.fillText("-", BEST_X, HUD_Y); // best-time persistence: deferred
  g.textAlign = "center";
  g.fillText(formatTime(state.tick), TIMER_X, HUD_Y);
  for (let i = 0; i < LIVES; i++) {
    drawHeart(g, 302 + i * 15, 60, 5, i < state.lives);
  }

  // Toast pill (top of the road, clear of the start-row smoke strip).
  if (state.toast) {
    const label = state.toast.params.labelKey
      ? t(state.toast.params.labelKey)
      : "";
    const text = t(state.toast.key, { ...state.toast.params, label });
    g.font = "700 13px Inter, system-ui, sans-serif";
    const w = g.measureText(text).width + 24;
    g.fillStyle = "rgba(12, 4, 28, 0.85)";
    g.beginPath();
    g.roundRect(GAME_W / 2 - w / 2, 92, w, 26, 13);
    g.fill();
    g.fillStyle = "#ffe066";
    g.fillText(text, GAME_W / 2, 105);
  }

  // Guard checkpoint beat: dim, guard, bobbing speech bubble.
  if (state.status === "checkpoint" && state.checkpointKind) {
    g.fillStyle = "rgba(8, 4, 18, 0.55)";
    g.fillRect(0, 0, GAME_W, GAME_H);
    const guardH = 62;
    const guardW =
      (guardH * images.checkpoint.naturalWidth) /
        images.checkpoint.naturalHeight || guardH;
    g.drawImage(
      images.checkpoint,
      HERO_X - guardW / 2,
      140 - guardH / 2,
      guardW,
      guardH,
    );
    const bubble =
      state.checkpointKind === "congrats" ? images.congrats : images.denied;
    const bubbleH = 68;
    const bubbleW =
      (bubbleH * bubble.naturalWidth) / bubble.naturalHeight || bubbleH;
    const bob = Math.sin(state.checkpointTimer * 0.15) * 3;
    g.drawImage(
      bubble,
      HERO_X - bubbleW / 2,
      66 - bubbleH / 2 + bob,
      bubbleW,
      bubbleH,
    );
  }

  // Control strip: delivered art; LEFT half = BACK, RIGHT half = FORWARD.
  g.drawImage(images.controls, 0, GAME_H, GAME_W, BAR_H);
}
