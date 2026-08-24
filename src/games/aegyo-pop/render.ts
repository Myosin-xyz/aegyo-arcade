import {
  COLS,
  DESIGN_H,
  DESIGN_W,
  LEVELS,
  OFFSET_TOP,
  RADIUS,
  SHOOTER_X,
  SHOOTER_Y,
  cellPosition,
  computeAimPath,
  formatClock,
  type AegyoPopState,
  type Bubble,
  type ColorKey,
  type ProjectileBubble,
} from "./logic";

export type OrbImages = Record<ColorKey, HTMLImageElement>;

export interface PopParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  color: string;
  size: number;
  lifeMs: number;
  totalMs: number;
}

export interface PopToast {
  text: string;
  color: string;
  lifeMs: number;
  totalMs: number;
}

export interface AegyoPopPresentation {
  nowMs: number;
  arcadeFont: string;
  particles: readonly PopParticle[];
  toast: PopToast | null;
}

type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

export const COLOR_HEX: Record<ColorKey, string> = {
  star: "#ff4fd8",
  heart: "#ff3b5c",
  diamond: "#4ff0ff",
  sun: "#ffd24f",
  moon: "#5affa0",
};

const RAINBOW = ["#ff4fd8", "#ffd24f", "#5affa0", "#4ff0ff", "#b06bff"];
const STARS = Array.from({ length: 34 }, (_, index) => ({
  x: (index * 137 + 11) % DESIGN_W,
  y: (index * 233 + 19) % DESIGN_H,
  size: index % 6 === 0 ? 2 : 1,
  phase: (index * 0.61) % (Math.PI * 2),
}));

function roundedPath(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + width, y, x + width, y + height, r);
  g.arcTo(x + width, y + height, x, y + height, r);
  g.arcTo(x, y + height, x, y, r);
  g.arcTo(x, y, x + width, y, r);
  g.closePath();
}

function text(
  g: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  font: string,
  color = "#fff",
  align: CanvasTextAlign = "center",
  maxWidth?: number,
): void {
  g.save();
  g.font = `700 ${size}px ${font}`;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.fillStyle = color;
  if (maxWidth) g.fillText(value, x, y, maxWidth);
  else g.fillText(value, x, y);
  g.restore();
}

function drawBackdrop(g: CanvasRenderingContext2D, nowMs: number): void {
  const gradient = g.createLinearGradient(0, 0, 0, DESIGN_H);
  gradient.addColorStop(0, "#241046");
  gradient.addColorStop(0.6, "#170a30");
  gradient.addColorStop(1, "#0a0318");
  g.fillStyle = gradient;
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);

  for (const star of STARS) {
    g.globalAlpha = 0.18 + 0.38 * Math.abs(Math.sin(nowMs / 900 + star.phase));
    g.fillStyle = star.phase > Math.PI ? "#4ff0ff" : "#fff";
    g.fillRect(star.x, star.y, star.size, star.size);
  }
  g.globalAlpha = 1;

  // Lightweight CRT treatment from the delivery, drawn inside the canvas so
  // previews and the game route share exactly the same authored surface.
  g.fillStyle = "rgba(0,0,0,.075)";
  for (let y = 0; y < DESIGN_H; y += 4) g.fillRect(0, y, DESIGN_W, 2);
  const vignette = g.createRadialGradient(
    DESIGN_W / 2,
    DESIGN_H / 2,
    DESIGN_W * 0.35,
    DESIGN_W / 2,
    DESIGN_H / 2,
    DESIGN_H * 0.62,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,.44)");
  g.fillStyle = vignette;
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);
}

function drawHud(
  g: CanvasRenderingContext2D,
  state: AegyoPopState,
  t: Translate,
  font: string,
): void {
  const labels = [
    t("game.aegyo-pop.hud.level"),
    t("game.aegyo-pop.hud.score"),
    t("game.aegyo-pop.hud.time"),
  ];
  const values = [
    `${state.level}/${LEVELS.length}`,
    String(state.score),
    formatClock(state.elapsedMs),
  ];
  const gap = 10;
  const margin = 14;
  const width = (DESIGN_W - margin * 2 - gap * 2) / 3;
  for (let index = 0; index < 3; index += 1) {
    const x = margin + index * (width + gap);
    g.save();
    g.fillStyle = "rgba(5,1,15,.84)";
    g.strokeStyle = "#ff4fd8";
    g.lineWidth = 2;
    g.shadowColor = "rgba(255,79,216,.55)";
    g.shadowBlur = 12;
    roundedPath(g, x, 13, width, 58, 12);
    g.fill();
    g.stroke();
    g.restore();
    text(
      g,
      labels[index].toUpperCase(),
      x + width / 2,
      29,
      8,
      font,
      "#4ff0ff",
      "center",
      width - 8,
    );
    text(
      g,
      values[index],
      x + width / 2,
      51,
      index === 1 ? 17 : 19,
      font,
      "#fff",
      "center",
      width - 8,
    );
  }

  g.save();
  g.fillStyle = "rgba(5,1,15,.84)";
  g.strokeStyle = "#ff4fd8";
  g.lineWidth = 2;
  g.shadowColor = "rgba(255,79,216,.42)";
  g.shadowBlur = 10;
  roundedPath(g, DESIGN_W / 2 - 48, 77, 96, 30, 10);
  g.fill();
  g.stroke();
  g.restore();
  text(
    g,
    `${t("game.aegyo-pop.hud.shots").toUpperCase()} ${state.shots}`,
    DESIGN_W / 2,
    92,
    10,
    font,
  );
}

function drawRainbowRing(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  nowMs: number,
): void {
  g.save();
  g.translate(x, y);
  g.rotate(nowMs / 500);
  RAINBOW.forEach((color, index) => {
    const start = (index / RAINBOW.length) * Math.PI * 2;
    g.strokeStyle = color;
    g.lineWidth = radius * 0.22;
    g.lineCap = "round";
    g.beginPath();
    g.arc(
      0,
      0,
      radius * 1.2,
      start,
      start + (Math.PI * 2 * 0.78) / RAINBOW.length,
    );
    g.stroke();
  });
  g.restore();
}

function drawOrb(
  g: CanvasRenderingContext2D,
  images: OrbImages,
  bubble: ProjectileBubble,
  x: number,
  y: number,
  radius: number,
  rotation: number,
  nowMs: number,
): void {
  if (bubble.special === "bomb") drawRainbowRing(g, x, y, radius, nowMs);
  const image = images[bubble.color];
  g.save();
  g.translate(x, y);
  g.rotate(rotation);
  g.shadowColor = COLOR_HEX[bubble.color];
  g.shadowBlur = 10;
  if (image?.complete && image.naturalWidth > 0) {
    g.drawImage(image, -radius, -radius, radius * 2, radius * 2);
  } else {
    g.fillStyle = COLOR_HEX[bubble.color];
    g.beginPath();
    g.arc(0, 0, radius * 0.92, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

function drawIceOverlay(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  hp: number,
  row: number,
  col: number,
): void {
  g.save();
  g.translate(x, y);
  const gradient = g.createRadialGradient(
    -radius * 0.25,
    -radius * 0.25,
    radius * 0.1,
    0,
    0,
    radius,
  );
  gradient.addColorStop(0, "rgba(220,250,255,.58)");
  gradient.addColorStop(1, "rgba(150,220,255,.28)");
  g.fillStyle = gradient;
  g.beginPath();
  g.arc(0, 0, radius * 0.92, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,.88)";
  g.lineWidth = 1.5;
  g.stroke();
  const seed = row * 97 + col * 13;
  const cracks = hp <= 1 ? 5 : 3;
  g.strokeStyle = "rgba(255,255,255,.92)";
  g.lineWidth = 1.2;
  for (let index = 0; index < cracks; index += 1) {
    const angle = (((seed * 13 + index * 57) % 360) * Math.PI) / 180;
    const length = radius * (0.45 + ((seed + index * 31) % 40) / 100);
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
    g.stroke();
  }
  g.restore();
}

function drawCaptive(
  g: CanvasRenderingContext2D,
  images: OrbImages,
  x: number,
  y: number,
  radius: number,
  nowMs: number,
  phase: number,
): void {
  g.save();
  g.translate(x, y);
  const gradient = g.createRadialGradient(
    -radius * 0.2,
    -radius * 0.2,
    radius * 0.15,
    0,
    0,
    radius,
  );
  gradient.addColorStop(0, "rgba(255,255,255,.92)");
  gradient.addColorStop(0.6, "rgba(200,220,255,.5)");
  gradient.addColorStop(1, "rgba(150,180,255,.25)");
  g.shadowColor = "#fff";
  g.shadowBlur = 14;
  g.fillStyle = gradient;
  g.beginPath();
  g.arc(0, 0, radius * 0.95, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = "rgba(255,255,255,.95)";
  g.setLineDash([4, 3]);
  g.lineWidth = 2;
  g.stroke();
  g.setLineDash([]);
  g.globalAlpha = 0.92;
  g.drawImage(
    images.heart,
    -radius * 0.55,
    -radius * 0.55,
    radius * 1.1,
    radius * 1.1,
  );
  g.globalAlpha = 1;
  const pulse = 0.5 + 0.5 * Math.sin(nowMs / 260 + phase);
  g.strokeStyle = `rgba(255,255,255,${0.3 + 0.4 * pulse})`;
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(0, 0, radius * 1.12, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

function drawCell(
  g: CanvasRenderingContext2D,
  images: OrbImages,
  cell: Bubble,
  row: number,
  col: number,
  nowMs: number,
): void {
  const position = cellPosition(row, col);
  if (cell.special === "captive") {
    drawCaptive(g, images, position.x, position.y, RADIUS, nowMs, row + col);
    return;
  }
  if (!cell.color) return;
  drawOrb(
    g,
    images,
    { color: cell.color, special: cell.special === "bomb" ? "bomb" : null },
    position.x,
    position.y,
    RADIUS,
    0,
    nowMs,
  );
  if (cell.special === "ice") {
    drawIceOverlay(g, position.x, position.y, RADIUS, cell.hp ?? 2, row, col);
  }
}

function drawDangerLine(
  g: CanvasRenderingContext2D,
  state: AegyoPopState,
  nowMs: number,
): void {
  const y = DESIGN_H * LEVELS[state.level - 1].ceilingLimit;
  const pulse = 0.5 + 0.5 * Math.sin(nowMs / (220 - state.dangerLevel * 140));
  const alpha = 0.45 + state.dangerLevel * 0.5 * pulse;
  g.save();
  g.strokeStyle = `rgba(255,90,122,${alpha})`;
  g.lineWidth = 2 + state.dangerLevel * 2;
  g.setLineDash([6, 6]);
  if (state.dangerLevel > 0.15) {
    g.shadowColor = "rgba(255,90,122,.9)";
    g.shadowBlur = 6 + state.dangerLevel * 14;
  }
  g.beginPath();
  g.moveTo(0, y);
  g.lineTo(DESIGN_W, y);
  g.stroke();
  g.restore();
}

function drawAimGuide(
  g: CanvasRenderingContext2D,
  state: AegyoPopState,
  nowMs: number,
): void {
  const path = computeAimPath(state);
  g.save();
  g.lineCap = "round";
  g.strokeStyle = "rgba(255,79,216,.35)";
  g.lineWidth = 9;
  g.beginPath();
  g.moveTo(path[0].x, path[0].y);
  for (const point of path.slice(1)) g.lineTo(point.x, point.y);
  g.stroke();
  g.strokeStyle = "#fff";
  g.lineWidth = 3.5;
  g.setLineDash([14, 10]);
  g.lineDashOffset = -(nowMs / 40) % 20;
  g.shadowColor = "#ff4fd8";
  g.shadowBlur = 10;
  g.beginPath();
  g.moveTo(path[0].x, path[0].y);
  for (const point of path.slice(1)) g.lineTo(point.x, point.y);
  g.stroke();
  g.restore();
  const end = path[path.length - 1];
  const pulse = 1 + 0.15 * Math.sin(nowMs / 150);
  g.save();
  g.strokeStyle = "#4ff0ff";
  g.lineWidth = 2.5;
  g.shadowColor = "#4ff0ff";
  g.shadowBlur = 12;
  g.beginPath();
  g.arc(end.x, end.y, RADIUS * 0.55 * pulse, 0, Math.PI * 2);
  g.stroke();
  g.restore();
}

function drawShooter(
  g: CanvasRenderingContext2D,
  images: OrbImages,
  loaded: ProjectileBubble | null,
  angle: number,
  nowMs: number,
): void {
  const color = loaded ? COLOR_HEX[loaded.color] : "#8a8398";
  g.save();
  g.translate(SHOOTER_X, SHOOTER_Y);
  g.rotate(angle + Math.PI / 2);
  const width = RADIUS * 0.5;
  const height = RADIUS * 1.15;
  const gradient = g.createLinearGradient(-width / 2, 0, width / 2, 0);
  gradient.addColorStop(0, "#2a2438");
  gradient.addColorStop(0.5, "#4a4258");
  gradient.addColorStop(1, "#221d2e");
  g.fillStyle = gradient;
  roundedPath(g, -width / 2, RADIUS * 0.05, width, height, width * 0.4);
  g.fill();
  g.strokeStyle = "rgba(0,0,0,.75)";
  g.lineWidth = 1.5;
  g.stroke();
  g.globalAlpha = loaded ? 0.85 : 0.5;
  g.fillStyle = loaded ? color : "#5a5468";
  roundedPath(g, -width / 2, RADIUS * 0.18, width, height * 0.22, width * 0.3);
  g.fill();
  g.globalAlpha = 1;
  if (loaded) {
    g.translate(0, -RADIUS * 0.55);
    g.rotate(-(angle + Math.PI / 2));
    drawOrb(g, images, loaded, 0, 0, RADIUS * 0.95, 0, nowMs);
  }
  g.restore();
}

function drawBoardAndShooter(
  g: CanvasRenderingContext2D,
  state: AegyoPopState,
  images: OrbImages,
  t: Translate,
  presentation: AegyoPopPresentation,
): void {
  drawDangerLine(g, state, presentation.nowMs);
  for (let row = 0; row < state.grid.length; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      const cell = state.grid[row][col];
      if (cell) drawCell(g, images, cell, row, col, presentation.nowMs);
    }
  }
  if (state.status === "playing" && !state.flying) {
    drawAimGuide(g, state, presentation.nowMs);
  }
  if (state.flying) {
    drawOrb(
      g,
      images,
      state.flying,
      state.flying.x,
      state.flying.y,
      RADIUS,
      state.flying.rotation,
      presentation.nowMs,
    );
  }
  drawShooter(g, images, state.loaded, state.aimAngle, presentation.nowMs);
  const nextX = SHOOTER_X + DESIGN_W * 0.24;
  const nextY = SHOOTER_Y - RADIUS * 0.1;
  text(
    g,
    t("game.aegyo-pop.hud.next").toUpperCase(),
    nextX,
    nextY - RADIUS * 0.95,
    9,
    presentation.arcadeFont,
    "rgba(255,255,255,.62)",
  );
  drawOrb(
    g,
    images,
    state.queued,
    nextX,
    nextY,
    RADIUS * 0.62,
    0,
    presentation.nowMs,
  );
}

function drawParticles(
  g: CanvasRenderingContext2D,
  particles: readonly PopParticle[],
): void {
  for (const particle of particles) {
    g.globalAlpha = Math.max(0, particle.lifeMs / particle.totalMs);
    g.fillStyle = particle.color;
    g.beginPath();
    g.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

function drawToast(
  g: CanvasRenderingContext2D,
  toast: PopToast,
  font: string,
): void {
  const progress = Math.max(0, toast.lifeMs / toast.totalMs);
  g.save();
  g.globalAlpha = Math.min(1, progress * 3);
  g.shadowColor = toast.color;
  g.shadowBlur = 18;
  text(
    g,
    toast.text,
    DESIGN_W / 2,
    196,
    18,
    font,
    toast.color,
    "center",
    DESIGN_W - 28,
  );
  g.restore();
}

function drawTransition(
  g: CanvasRenderingContext2D,
  state: AegyoPopState,
  t: Translate,
  font: string,
): void {
  const nextLevel = state.level + 1;
  const config = LEVELS[nextLevel - 1];
  g.fillStyle = "rgba(5,1,15,.9)";
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);
  g.save();
  g.shadowColor = "#ff4fd8";
  g.shadowBlur = 22;
  text(
    g,
    t("game.aegyo-pop.transition.title", { level: nextLevel }),
    DESIGN_W / 2,
    300,
    31,
    font,
    "#fff",
    "center",
    DESIGN_W - 30,
  );
  g.restore();
  text(
    g,
    t("game.aegyo-pop.transition.stats", {
      rows: config.rows,
      colors: config.colorCount,
    }),
    DESIGN_W / 2,
    355,
    14,
    font,
    "#ffd6f5",
    "center",
    DESIGN_W - 34,
  );
  text(
    g,
    t("game.aegyo-pop.transition.hint"),
    DESIGN_W / 2,
    386,
    12,
    font,
    "#4ff0ff",
    "center",
    DESIGN_W - 34,
  );
  g.fillStyle = "rgba(255,79,216,.16)";
  g.strokeStyle = "#ff4fd8";
  g.lineWidth = 2;
  roundedPath(g, DESIGN_W / 2 - 104, 424, 208, 54, 14);
  g.fill();
  g.stroke();
  text(g, t("game.aegyo-pop.transition.continue"), DESIGN_W / 2, 451, 14, font);
}

function drawResult(
  g: CanvasRenderingContext2D,
  state: AegyoPopState,
  t: Translate,
  font: string,
): void {
  g.fillStyle = "rgba(5,1,15,.9)";
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);
  const won = state.status === "won";
  const title = t(
    won ? "game.aegyo-pop.end.winTitle" : "game.aegyo-pop.end.lostTitle",
  );
  g.save();
  g.shadowColor = won ? "#ffd24f" : "#ff4fd8";
  g.shadowBlur = 24;
  text(
    g,
    title,
    DESIGN_W / 2,
    250,
    won ? 26 : 28,
    font,
    won ? "#ffd24f" : "#fff",
    "center",
    DESIGN_W - 28,
  );
  g.restore();
  if (won) {
    text(
      g,
      t("game.aegyo-pop.end.winDetail"),
      DESIGN_W / 2,
      296,
      12,
      font,
      "#4ff0ff",
      "center",
      DESIGN_W - 32,
    );
  }
  const lines = [
    t("game.aegyo-pop.end.level", { level: state.level }),
    t("game.aegyo-pop.end.score", { score: state.score }),
    t("game.aegyo-pop.end.time", { time: formatClock(state.elapsedMs) }),
    t("game.aegyo-pop.end.shots", { shots: state.shots }),
  ];
  lines.forEach((line, index) => {
    text(
      g,
      line,
      DESIGN_W / 2,
      345 + index * 38,
      15,
      font,
      index === 1 ? "#ffd24f" : "#ffd6f5",
      "center",
      DESIGN_W - 36,
    );
  });
}

export function renderAegyoPop(
  g: CanvasRenderingContext2D,
  state: AegyoPopState,
  images: OrbImages,
  presentation: AegyoPopPresentation,
  t: Translate,
): void {
  drawBackdrop(g, presentation.nowMs);
  if (state.status !== "won") {
    drawBoardAndShooter(g, state, images, t, presentation);
  }
  drawHud(g, state, t, presentation.arcadeFont);
  drawParticles(g, presentation.particles);
  if (presentation.toast) {
    drawToast(g, presentation.toast, presentation.arcadeFont);
  }
  if (state.status === "transition") {
    drawTransition(g, state, t, presentation.arcadeFont);
  } else if (state.status === "over" || state.status === "won") {
    drawResult(g, state, t, presentation.arcadeFont);
  }
}

export function isBoardPoint(x: number, y: number): boolean {
  return x >= 0 && x <= DESIGN_W && y >= OFFSET_TOP && y <= DESIGN_H;
}
