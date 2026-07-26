/**
 * Snake Freebies renderer — the delivery's synthwave personality rebuilt
 * inside the shell-owned canvas.
 *
 * Mechanics stay in logic.ts. This layer owns the authored presentation:
 * neon sky/grid, framed two-row HUD, arena, impact beat, catch toast and
 * level card. Everything is procedural or uses DaiDai's supplied sprites,
 * so it remains sharp and cheap at mobile DPRs.
 */

import {
  DEATH_PAUSE_MS,
  LIVES_PER_LEVEL,
  gridOf,
  levelTarget,
  type SnakeState,
} from "./logic";

export interface SnakeImages {
  head: HTMLImageElement;
  gift: HTMLImageElement;
  frame: HTMLImageElement;
  /** f00..f18, chain order */
  freebies: HTMLImageElement[];
}

export interface SnakePresentation {
  /** Fully translated, upper/lower case preserved by the locale. */
  toast: string | null;
  toastOpacity: number;
  /** Resolved next/font family, with a monospace fallback. */
  arcadeFont: string;
}

export const DESIGN_W = 360;
export const DESIGN_H = 640;
/** Two-row HUD ends at 94; the authored arena starts below it. */
const ARENA_TOP = 120;
const ARENA_MARGIN = 20;

type Translate = (key: string, params?: Record<string, string>) => string;

const STARS = Array.from({ length: 30 }, (_, i) => ({
  x: (i * 83 + 19) % DESIGN_W,
  y: (i * 47 + 13) % 430,
  size: i % 7 === 0 ? 2 : 1,
  phase: (i * 0.73) % (Math.PI * 2),
}));

function arcadeFont(
  presentation: SnakePresentation,
  weight: number,
  size: number,
): string {
  return `${weight} ${size}px ${presentation.arcadeFont}`;
}

function roundedRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  g.beginPath();
  if (typeof g.roundRect === "function") g.roundRect(x, y, w, h, radius);
  else g.rect(x, y, w, h);
}

/** 90s sky + horizon + perspective grid from DaiDai's delivery. */
function drawBackdrop(g: CanvasRenderingContext2D, now: number): void {
  g.fillStyle = "#05010f";
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);
  g.fillStyle = "#17002f";
  g.fillRect(0, 335, DESIGN_W, 105);
  g.fillStyle = "#4a1070";
  g.fillRect(0, 440, DESIGN_W, 52);
  g.fillStyle = "#180323";
  g.fillRect(0, 492, DESIGN_W, DESIGN_H - 492);

  for (const star of STARS) {
    const alpha = 0.34 + 0.66 * Math.abs(Math.sin(now / 850 + star.phase));
    g.globalAlpha = alpha;
    g.fillStyle = star.phase > Math.PI ? "#4ff0ff" : "#ffd6f5";
    g.fillRect(star.x, star.y, star.size, star.size);
    if (star.size > 1) {
      g.fillRect(star.x - 2, star.y, 5, 1);
      g.fillRect(star.x, star.y - 2, 1, 5);
    }
  }
  g.globalAlpha = 1;

  // Slatted neon sun. It sits behind the controller cross.
  g.save();
  g.globalAlpha = 0.4;
  g.fillStyle = "#ff4fd8";
  g.shadowColor = "#ff4fd8";
  g.shadowBlur = 24;
  g.beginPath();
  g.arc(DESIGN_W / 2, 485, 64, Math.PI, 0);
  g.fill();
  g.restore();
  g.fillStyle = "#180323";
  for (let y = 466; y < 488; y += 7) g.fillRect(116, y, 128, 3);

  // Perspective floor: radial spokes + accelerating horizontal rows.
  g.strokeStyle = "rgba(79, 240, 255, 0.32)";
  g.lineWidth = 1;
  for (let x = -80; x <= DESIGN_W + 80; x += 40) {
    g.beginPath();
    g.moveTo(DESIGN_W / 2, 470);
    g.lineTo(x, DESIGN_H);
    g.stroke();
  }
  g.strokeStyle = "rgba(255, 79, 216, 0.4)";
  for (const y of [480, 495, 515, 540, 570, 606]) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(DESIGN_W, y);
    g.stroke();
  }
}

/** Arena geometry: a centred square sized to whole cells (no seams). */
export function arenaBox(state: SnakeState): {
  x: number;
  y: number;
  size: number;
  cell: number;
} {
  const grid = gridOf(state);
  const avail = Math.min(
    DESIGN_W - ARENA_MARGIN * 2,
    DESIGN_H - ARENA_TOP - ARENA_MARGIN,
  );
  const cell = Math.floor(avail / grid);
  const size = cell * grid;
  return { x: Math.round((DESIGN_W - size) / 2), y: ARENA_TOP, size, cell };
}

function drawHudBox(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  g.save();
  g.shadowColor = "rgba(255, 79, 216, 0.58)";
  g.shadowBlur = 8;
  roundedRect(g, x, y, w, h, 9);
  g.fillStyle = "rgba(5, 1, 15, 0.88)";
  g.fill();
  g.strokeStyle = "rgba(255, 79, 216, 0.82)";
  g.lineWidth = 1.5;
  g.stroke();
  g.restore();
}

function drawHeart(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  filled: boolean,
): void {
  g.save();
  g.translate(x, y);
  g.beginPath();
  g.moveTo(0, 4);
  g.bezierCurveTo(-9, -2, -6, -9, 0, -5);
  g.bezierCurveTo(6, -9, 9, -2, 0, 4);
  g.fillStyle = filled ? "#ff4f8b" : "rgba(255, 255, 255, 0.18)";
  g.shadowColor = filled ? "#ff4fd8" : "transparent";
  g.shadowBlur = filled ? 5 : 0;
  g.fill();
  g.restore();
}

function drawHud(
  g: CanvasRenderingContext2D,
  state: SnakeState,
  t: Translate,
  presentation: SnakePresentation,
): void {
  const mm = String(Math.floor(state.elapsed / 60)).padStart(2, "0");
  const ss = String(Math.floor(state.elapsed % 60)).padStart(2, "0");
  const topCells: [string, string][] = [
    [t("game.snake.hud.level"), `${state.level + 1}/3`],
    [t("game.snake.hud.score"), String(state.score)],
    [t("game.snake.hud.time"), `${mm}:${ss}`],
  ];
  const x0 = 14;
  const gap = 8;
  const topW = (DESIGN_W - x0 * 2 - gap * 2) / 3;

  g.textBaseline = "middle";
  topCells.forEach(([label, value], i) => {
    const x = x0 + i * (topW + gap);
    drawHudBox(g, x, 10, topW, 38);
    g.textAlign = "left";
    g.fillStyle = "#4ff0ff";
    g.font = arcadeFont(presentation, 700, 8);
    g.fillText(label.toUpperCase(), x + 8, 21);
    g.fillStyle = "#ffffff";
    g.font = arcadeFont(presentation, 700, 14);
    g.fillText(value, x + 8, 37);
  });

  const lowerW = (DESIGN_W - x0 * 2 - gap) / 2;
  drawHudBox(g, x0, 57, lowerW, 38);
  drawHudBox(g, x0 + lowerW + gap, 57, lowerW, 38);

  g.textAlign = "left";
  g.fillStyle = "#4ff0ff";
  g.font = arcadeFont(presentation, 700, 8);
  g.fillText(t("game.snake.hud.lives").toUpperCase(), x0 + 8, 68);
  g.fillText(
    t("game.snake.hud.freebies").toUpperCase(),
    x0 + lowerW + gap + 8,
    68,
  );
  for (let i = 0; i < LIVES_PER_LEVEL; i++) {
    drawHeart(g, x0 + 15 + i * 19, 83, i < state.lives);
  }
  g.fillStyle = "#ffd6f5";
  g.font = arcadeFont(presentation, 700, 12);
  g.fillText(
    `🎁 ${state.gifts}/${levelTarget(state)}`,
    x0 + lowerW + gap + 8,
    84,
  );
}

function drawArena(
  g: CanvasRenderingContext2D,
  state: SnakeState,
  images: SnakeImages,
  now: number,
): void {
  const { x: ax, y: ay, size, cell } = arenaBox(state);
  const grid = gridOf(state);
  const impact = state.status === "dying" ? state.deathPauseMs : 0;
  const shakeWindow = Math.max(0, Math.min(1, (impact - 500) / 400));
  const shakeX = Math.sin(impact * 0.09) * 3.5 * shakeWindow;
  const shakeY = Math.cos(impact * 0.12) * 1.5 * shakeWindow;

  g.save();
  g.translate(shakeX, shakeY);
  g.fillStyle = "rgba(3, 0, 12, 0.9)";
  g.fillRect(ax - 10, ay - 10, size + 20, size + 20);

  g.fillStyle = "#0d0520";
  g.fillRect(ax, ay, size, size);
  g.strokeStyle = "rgba(123, 47, 247, 0.2)";
  g.lineWidth = 1;
  for (let i = 1; i < grid; i++) {
    g.beginPath();
    g.moveTo(ax + i * cell, ay);
    g.lineTo(ax + i * cell, ay + size);
    g.stroke();
    g.beginPath();
    g.moveTo(ax, ay + i * cell);
    g.lineTo(ax + size, ay + i * cell);
    g.stroke();
  }

  const pad = Math.max(1, Math.floor(cell * 0.06));
  const pulse = 1 + 0.06 * Math.sin(now / 220);
  const giftSize = (cell - 2 * pad) * pulse;
  g.save();
  g.shadowColor = "#ff4fd8";
  g.shadowBlur = 10;
  g.drawImage(
    images.gift,
    ax + state.food.x * cell + (cell - giftSize) / 2,
    ay + state.food.y * cell + (cell - giftSize) / 2,
    giftSize,
    giftSize,
  );
  g.restore();

  for (let i = state.snake.length - 1; i >= 1; i--) {
    const segment = state.snake[i];
    const sprite = images.freebies[state.bodySprites[i - 1]];
    if (!sprite) continue;
    g.drawImage(
      sprite,
      ax + segment.x * cell,
      ay + segment.y * cell,
      cell,
      cell,
    );
  }

  const head = state.snake[0];
  if (head) {
    g.save();
    g.translate(ax + head.x * cell + cell / 2, ay + head.y * cell + cell / 2);
    g.rotate(Math.atan2(state.dir.y, state.dir.x));
    g.shadowColor = "#f74f8b";
    g.shadowBlur = 12;
    g.drawImage(images.head, -cell / 2, -cell / 2, cell, cell);
    g.restore();
  }

  g.drawImage(images.frame, ax - 6, ay - 6, size + 12, size + 12);

  // DaiDai's flash is a quick first beat, not a 900 ms red blanket.
  if (impact > DEATH_PAUSE_MS - 300) {
    g.save();
    g.globalAlpha = 0.35 * ((impact - (DEATH_PAUSE_MS - 300)) / 300);
    g.fillStyle = "#ff285a";
    g.fillRect(ax, ay, size, size);
    g.restore();
  }
  g.restore();
}

function drawToast(
  g: CanvasRenderingContext2D,
  presentation: SnakePresentation,
): void {
  if (!presentation.toast || presentation.toastOpacity <= 0) return;
  g.save();
  g.globalAlpha = presentation.toastOpacity;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = arcadeFont(presentation, 700, 16);
  g.fillStyle = "#ffffff";
  g.shadowColor = "#ff4fd8";
  g.shadowBlur = 14;
  g.fillText(presentation.toast.toUpperCase(), DESIGN_W / 2, 285);
  g.restore();
}

export function renderSnake(
  g: CanvasRenderingContext2D,
  state: SnakeState,
  images: SnakeImages,
  t: Translate,
  now: number,
  presentation: SnakePresentation = {
    toast: null,
    toastOpacity: 0,
    arcadeFont: "monospace",
  },
): void {
  g.clearRect(0, 0, DESIGN_W, DESIGN_H);
  drawBackdrop(g, now);
  drawHud(g, state, t, presentation);
  drawArena(g, state, images, now);
  drawToast(g, presentation);

  if (state.status === "levelBreak") {
    g.save();
    g.fillStyle = "rgba(5, 1, 15, 0.92)";
    g.fillRect(0, 0, DESIGN_W, DESIGN_H);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillStyle = "#4ff0ff";
    g.shadowColor = "#4ff0ff";
    g.shadowBlur = 9;
    g.font = arcadeFont(presentation, 700, 11);
    g.fillText(
      t(`game.snake.rank.${state.level}`).toUpperCase(),
      DESIGN_W / 2,
      DESIGN_H * 0.39,
    );
    g.fillStyle = "#ffffff";
    g.shadowColor = "#ff4fd8";
    g.shadowBlur = 16;
    g.font = arcadeFont(presentation, 700, 28);
    g.fillText(
      t("game.snake.levelUp", { level: String(state.level + 2) }),
      DESIGN_W / 2,
      DESIGN_H * 0.47,
    );
    g.fillStyle = "#ffd6f5";
    g.shadowBlur = 0;
    g.font = arcadeFont(presentation, 700, 12);
    g.fillText(
      t("game.snake.nextTarget", {
        count: String(levelTarget({ ...state, level: state.level + 1 })),
      }),
      DESIGN_W / 2,
      DESIGN_H * 0.54,
    );
    g.fillStyle = "#140321";
    roundedRect(g, 84, DESIGN_H * 0.6, 192, 54, 14);
    g.fill();
    g.strokeStyle = "#4ff0ff";
    g.lineWidth = 2;
    g.stroke();
    g.fillStyle = "#ffffff";
    g.font = arcadeFont(presentation, 700, 15);
    g.fillText(t("game.snake.tapToGo"), DESIGN_W / 2, DESIGN_H * 0.642);
    g.restore();
  }
}
