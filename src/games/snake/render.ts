/**
 * Snake Freebies renderer — pure draw over SnakeState.
 *
 * The delivery's synthwave page chrome (CSS sun/grid/starfield) is NOT
 * ported: the shell already owns a dark arcade background, and re-creating
 * a full-page CSS scene inside a letterboxed canvas would fight it. What
 * ports is the arena itself: neon frame, faint grid, glowing gift box, the
 * freebie chain, and the direction-rotated head.
 */

import { LIVES_PER_LEVEL, gridOf, levelTarget, type SnakeState } from "./logic";

export interface SnakeImages {
  head: HTMLImageElement;
  gift: HTMLImageElement;
  frame: HTMLImageElement;
  /** f00..f18, chain order */
  freebies: HTMLImageElement[];
}

export const DESIGN_W = 360;
export const DESIGN_H = 640;
/** Arena square inset inside the design box, leaving room for the HUD. */
const ARENA_TOP = 96;
const ARENA_MARGIN = 20;

type Translate = (key: string, params?: Record<string, string>) => string;

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

function drawHud(
  g: CanvasRenderingContext2D,
  state: SnakeState,
  t: Translate,
): void {
  g.textBaseline = "middle";
  g.font = "700 12px system-ui, sans-serif";

  // LEVEL / SCORE / TIME row.
  const mm = String(Math.floor(state.elapsed / 60)).padStart(2, "0");
  const ss = String(Math.floor(state.elapsed % 60)).padStart(2, "0");
  const cells: [string, string][] = [
    [t("game.snake.hud.level"), `${state.level + 1}/3`],
    [t("game.snake.hud.score"), String(state.score)],
    [t("game.snake.hud.time"), `${mm}:${ss}`],
  ];
  const boxW = (DESIGN_W - ARENA_MARGIN * 2 - 16) / 3;
  cells.forEach(([label, value], i) => {
    const x = ARENA_MARGIN + i * (boxW + 8);
    g.fillStyle = "rgba(43, 17, 70, 0.85)";
    g.beginPath();
    if (typeof g.roundRect === "function") g.roundRect(x, 20, boxW, 34, 8);
    else g.rect(x, 20, boxW, 34);
    g.fill();
    g.fillStyle = "#b9a8e0";
    g.font = "700 9px system-ui, sans-serif";
    g.textAlign = "left";
    g.fillText(label.toUpperCase(), x + 8, 31);
    g.fillStyle = "#ffffff";
    g.font = "800 15px system-ui, sans-serif";
    g.fillText(value, x + 8, 45);
  });

  // Lives + freebie progress.
  g.textAlign = "left";
  g.font = "700 12px system-ui, sans-serif";
  for (let i = 0; i < LIVES_PER_LEVEL; i++) {
    g.fillStyle = i < state.lives ? "#ff4f8b" : "rgba(255,255,255,0.22)";
    g.beginPath();
    g.arc(ARENA_MARGIN + 6 + i * 16, 70, 5, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = "#ffd166";
  g.textAlign = "right";
  g.fillText(
    `${state.gifts} / ${levelTarget(state)}`,
    DESIGN_W - ARENA_MARGIN,
    70,
  );
}

export function renderSnake(
  g: CanvasRenderingContext2D,
  state: SnakeState,
  images: SnakeImages,
  t: Translate,
  now: number,
): void {
  g.clearRect(0, 0, DESIGN_W, DESIGN_H);
  drawHud(g, state, t);

  const { x: ax, y: ay, size, cell } = arenaBox(state);
  const grid = gridOf(state);

  // Arena floor + faint grid (delivery's violet 15% lines).
  g.fillStyle = "rgba(12, 4, 28, 0.72)";
  g.fillRect(ax, ay, size, size);
  g.strokeStyle = "rgba(123, 47, 247, 0.15)";
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

  // Gift box with the delivery's glow pulse.
  const pad = Math.max(1, Math.floor(cell * 0.06));
  const pulse = 1 + 0.06 * Math.sin(now / 220);
  const gs = (cell - 2 * pad) * pulse;
  g.save();
  g.shadowColor = "#ff4fd8";
  g.shadowBlur = 10;
  g.drawImage(
    images.gift,
    ax + state.food.x * cell + (cell - gs) / 2,
    ay + state.food.y * cell + (cell - gs) / 2,
    gs,
    gs,
  );
  g.restore();

  // Freebie chain, tail first so the head overlaps.
  for (let i = state.snake.length - 1; i >= 1; i--) {
    const seg = state.snake[i];
    const sprite = images.freebies[state.bodySprites[i - 1]];
    if (!sprite) continue;
    g.drawImage(sprite, ax + seg.x * cell, ay + seg.y * cell, cell, cell);
  }

  // Head, glowing and rotated toward travel.
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

  // Neon frame around the arena (authored 304×304, stretched to the box).
  g.drawImage(images.frame, ax - 6, ay - 6, size + 12, size + 12);

  // Death beat: red wash while the chain is re-emerging.
  if (state.status === "dying") {
    g.save();
    g.globalAlpha = 0.3;
    g.fillStyle = "#ff2a3c";
    g.fillRect(ax, ay, size, size);
    g.restore();
  }

  // Level break stays IN the run (the host owns only the terminal panel).
  if (state.status === "levelBreak") {
    g.save();
    g.fillStyle = "rgba(12, 4, 28, 0.9)";
    g.fillRect(0, 0, DESIGN_W, DESIGN_H);
    g.textAlign = "center";
    g.fillStyle = "#ffd166";
    g.font = "800 13px system-ui, sans-serif";
    g.fillText(
      t(`game.snake.rank.${state.level}`).toUpperCase(),
      DESIGN_W / 2,
      DESIGN_H * 0.4,
    );
    g.fillStyle = "#ffffff";
    g.font = "800 26px system-ui, sans-serif";
    g.fillText(
      t("game.snake.levelUp", { level: String(state.level + 2) }),
      DESIGN_W / 2,
      DESIGN_H * 0.46,
    );
    g.fillStyle = "#b9a8e0";
    g.font = "600 14px system-ui, sans-serif";
    g.fillText(
      t("game.snake.nextTarget", {
        count: String(levelTarget({ ...state, level: state.level + 1 })),
      }),
      DESIGN_W / 2,
      DESIGN_H * 0.51,
    );
    g.fillStyle = "#7dffd9";
    g.font = "700 15px system-ui, sans-serif";
    g.fillText(t("game.snake.tapToGo"), DESIGN_W / 2, DESIGN_H * 0.58);
    g.restore();
  }
}
