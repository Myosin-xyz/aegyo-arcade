import {
  DESIGN_H,
  DESIGN_W,
  RUN_TICKS,
  type FlyingItem,
  type NoCapState,
} from "./logic";

export type NoCapImages = Record<string, HTMLImageElement>;
export interface NoCapParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}
export interface NoCapDebris {
  item: FlyingItem;
  half: 0 | 1;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  life: number;
}
export interface NoCapTrailPoint {
  x: number;
  y: number;
  age: number;
}
export interface NoCapEffects {
  particles: NoCapParticle[];
  debris: NoCapDebris[];
  trail: NoCapTrailPoint[];
  toast: { text: string; color: string; ticks: number } | null;
  shakeTicks: number;
}

const FONT = '"Bungee", Impact, "Arial Black", system-ui, sans-serif';

function text(
  g: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color = "#fff",
  align: CanvasTextAlign = "center",
): void {
  g.save();
  g.fillStyle = color;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.font = `900 ${size}px ${FONT}`;
  g.shadowColor = color;
  g.shadowBlur = 9;
  g.fillText(value, x, y);
  g.restore();
}

function drawItem(
  g: CanvasRenderingContext2D,
  item: FlyingItem,
  images: NoCapImages,
  x = item.x,
  y = item.y,
  rot = item.rot,
): void {
  const image = images[`${item.fake ? "fake" : "real"}_${item.key}`];
  if (!image?.naturalWidth) return;
  const height = DESIGN_W * 0.11 * 1.15;
  const width = (height * image.naturalWidth) / image.naturalHeight;
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  if (item.gold || item.silver) {
    g.shadowColor = item.gold ? "#ffd24f" : "#4ff0ff";
    g.shadowBlur = 20;
  }
  g.drawImage(image, -width / 2, -height / 2, width, height);
  g.restore();
}

function drawScalper(
  g: CanvasRenderingContext2D,
  images: NoCapImages,
  throwing: boolean,
): void {
  const image = images[throwing ? "scalper_throw" : "scalper_stand"];
  if (!image?.naturalWidth) return;
  const height = DESIGN_W * 0.3;
  const width = (height * image.naturalWidth) / image.naturalHeight;
  g.save();
  g.globalAlpha = 0.92;
  g.drawImage(
    image,
    DESIGN_W * 0.14 - width / 2,
    DESIGN_H * 0.995 - height,
    width,
    height,
  );
  g.restore();
}

export function renderNoCap(
  g: CanvasRenderingContext2D,
  state: NoCapState,
  images: NoCapImages,
  effects: NoCapEffects,
  t: (key: string, vars?: Record<string, string | number>) => string,
): void {
  g.save();
  if (effects.shakeTicks > 0) {
    const amp = effects.shakeTicks > 16 ? 6 : 2;
    g.translate(
      Math.sin(state.tick * 17) * amp,
      Math.cos(state.tick * 11) * amp,
    );
  }
  const background = g.createLinearGradient(0, 0, 0, DESIGN_H);
  background.addColorStop(0, "#241046");
  background.addColorStop(0.6, "#170a30");
  background.addColorStop(1, "#0a0318");
  g.fillStyle = background;
  g.fillRect(-10, -10, DESIGN_W + 20, DESIGN_H + 20);
  g.fillStyle = "#fff";
  for (let i = 0; i < 30; i++) {
    g.globalAlpha = 0.15 + (0.4 * ((i * 53) % 40)) / 40;
    g.fillRect(
      (i * 137) % DESIGN_W,
      (i * 233) % DESIGN_H,
      1 + (i % 2),
      1 + (i % 2),
    );
  }
  g.globalAlpha = 1;
  drawScalper(g, images, state.scalperThrowTicks > 0);
  for (const item of state.items) drawItem(g, item, images);
  for (const debris of effects.debris) {
    g.save();
    g.globalAlpha = Math.max(0, debris.life);
    g.beginPath();
    const size = DESIGN_W * 0.11;
    if (debris.half === 0)
      g.rect(debris.x - size, debris.y - size, size * 2, size);
    else g.rect(debris.x - size, debris.y, size * 2, size);
    g.clip();
    drawItem(g, debris.item, images, debris.x, debris.y, debris.rot);
    g.restore();
  }
  for (const particle of effects.particles) {
    g.globalAlpha = Math.max(0, particle.life);
    g.fillStyle = particle.color;
    g.beginPath();
    g.arc(particle.x, particle.y, 2.5, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  if (effects.trail.length > 1) {
    g.save();
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#fff";
    g.shadowColor = "#ff4fd8";
    g.shadowBlur = 12;
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(effects.trail[0].x, effects.trail[0].y);
    for (const point of effects.trail.slice(1)) g.lineTo(point.x, point.y);
    g.stroke();
    g.restore();
  }
  g.restore();

  // HUD and CRT sit outside the shake transform, as in the supplied game.
  g.fillStyle = "rgba(4,1,16,.87)";
  for (const x of [14, 185]) {
    g.fillRect(x, 14, 161, 62);
    g.strokeStyle = "#ff4fd8";
    g.lineWidth = 2;
    g.strokeRect(x, 14, 161, 62);
  }
  text(g, t("game.no-cap.hud.score"), 94, 32, 12, "#4ff0ff");
  text(g, String(state.score), 94, 56, 23);
  text(g, t("game.no-cap.hud.best"), 265, 32, 12, "#4ff0ff");
  text(g, String(state.bestScore), 265, 56, 23);
  g.fillStyle = "rgba(4,1,16,.9)";
  g.fillRect(14, 86, DESIGN_W - 28, 16);
  g.strokeStyle = "#ff4fd8";
  g.strokeRect(14, 86, DESIGN_W - 28, 16);
  const fraction = Math.max(0, 1 - state.tick / RUN_TICKS);
  g.fillStyle =
    fraction < 0.2 ? "#ff5a7a" : fraction < 0.45 ? "#ffd24f" : "#5affa0";
  g.fillRect(17, 89, (DESIGN_W - 34) * fraction, 10);
  if (state.combo >= 2 && state.tick - state.lastHitTick < 0.7 * 60) {
    const tier =
      state.combo >= 8
        ? ["game.no-cap.combo.legendary", "#ffd24f"]
        : state.combo >= 6
          ? ["game.no-cap.combo.buster", "#ff4fd8"]
          : state.combo >= 4
            ? ["game.no-cap.combo.streak", "#4ff0ff"]
            : ["game.no-cap.combo.busted", "#5affa0"];
    text(g, `×${state.combo}`, DESIGN_W / 2, 124, 28, tier[1]);
    text(g, t(tier[0]), DESIGN_W / 2, 149, 13, tier[1]);
  }
  if (effects.toast && effects.toast.ticks > 0)
    text(g, effects.toast.text, DESIGN_W / 2, 190, 20, effects.toast.color);
  g.fillStyle = "rgba(0,0,0,.09)";
  for (let y = 0; y < DESIGN_H; y += 4) g.fillRect(0, y, DESIGN_W, 2);
  const vignette = g.createRadialGradient(180, 320, 100, 180, 320, 420);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,.45)");
  g.fillStyle = vignette;
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);
  if (state.status === "over") {
    g.fillStyle = "rgba(5,1,15,.88)";
    g.fillRect(0, 0, DESIGN_W, DESIGN_H);
    const overTitle = t("game.no-cap.over.title");
    g.font = `900 34px ${FONT}`;
    const overSize = Math.min(
      34,
      Math.floor((34 * 320) / Math.max(320, g.measureText(overTitle).width)),
    );
    text(g, overTitle, 180, 260, overSize, "#ff5a7a");
    text(g, `${t("game.no-cap.hud.score")}: ${state.score}`, 180, 315, 20);
    text(
      g,
      `${t("game.no-cap.hud.best")}: ${state.bestScore}`,
      180,
      350,
      18,
      "#ffd24f",
    );
  }
}
