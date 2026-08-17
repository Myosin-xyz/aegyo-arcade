import {
  DESIGN_H,
  DESIGN_W,
  cardHeight,
  heightOf,
  rankIndexForHeight,
  type FallingCard,
  type PhotocardStackState,
} from "./logic";

export interface PhotocardImages {
  normal: HTMLImageElement[];
  holo: HTMLImageElement[];
}

export type StackParticle =
  | {
      type: "card";
      card: FallingCard;
      vx: number;
      vy: number;
      rotation: number;
      rotationSpeed: number;
      life: number;
    }
  | {
      type: "spark";
      x: number;
      y: number;
      vx: number;
      vy: number;
      color: string;
      size: number;
      life: number;
    };

export interface StackToast {
  text: string;
  color: string;
  life: number;
}

type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

const FONT = '"Arial Black", "Trebuchet MS", system-ui, sans-serif';

function roundedPath(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const r = Math.min(radius, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function drawCard(
  g: CanvasRenderingContext2D,
  card: { x: number; y: number; w: number; art: number; holo: boolean },
  images: PhotocardImages,
  glow: boolean,
): void {
  const h = cardHeight(card.w);
  const radius = Math.min(9, card.w * 0.09);
  const image = (card.holo ? images.holo : images.normal)[card.art];
  g.save();
  if (glow) {
    g.shadowColor = card.holo ? "#ffd24f" : "#ff4fd8";
    g.shadowBlur = 16;
  }
  roundedPath(g, card.x, card.y, card.w, h, radius);
  g.clip();
  if (image?.complete && image.naturalWidth > 0) {
    g.drawImage(image, card.x, card.y, card.w, h);
  } else {
    g.fillStyle = card.holo ? "#ffcf5a" : "#c98cff";
    g.fillRect(card.x, card.y, card.w, h);
  }
  g.restore();

  g.save();
  g.strokeStyle = card.holo ? "rgba(255,210,79,.95)" : "rgba(255,255,255,.92)";
  g.lineWidth = card.holo ? 3 : 2;
  roundedPath(g, card.x + 1, card.y + 1, card.w - 2, h - 2, radius);
  g.stroke();
  g.restore();
}

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
  g.font = `900 ${size}px ${FONT}`;
  g.textAlign = align;
  g.textBaseline = "middle";
  g.fillStyle = color;
  g.fillText(value, x, y);
  g.restore();
}

function drawHud(
  g: CanvasRenderingContext2D,
  state: PhotocardStackState,
  t: Translate,
): void {
  const values = [heightOf(state), state.score, state.bestHeight];
  const labels = [
    t("game.photocard-stack.hud.height"),
    t("game.photocard-stack.hud.score"),
    t("game.photocard-stack.hud.best"),
  ];
  const gap = 8;
  const x0 = 12;
  const width = (DESIGN_W - x0 * 2 - gap * 2) / 3;
  for (let i = 0; i < 3; i += 1) {
    const x = x0 + i * (width + gap);
    g.save();
    g.fillStyle = "rgba(5,1,15,.84)";
    g.strokeStyle = "#ff4fd8";
    g.lineWidth = 2;
    g.shadowColor = "rgba(255,79,216,.55)";
    g.shadowBlur = 12;
    roundedPath(g, x, 12, width, 58, 12);
    g.fill();
    g.stroke();
    g.restore();
    text(g, labels[i].toUpperCase(), x + width / 2, 28, 8, "#4ff0ff");
    text(g, String(values[i]), x + width / 2, 50, 19);
  }

  if (state.status === "playing") {
    const rank = t(
      `game.photocard-stack.rank.${rankIndexForHeight(heightOf(state))}`,
    );
    g.save();
    g.fillStyle = "rgba(5,1,15,.74)";
    g.strokeStyle = "rgba(255,210,79,.55)";
    roundedPath(g, 78, 82, 204, 28, 10);
    g.fill();
    g.stroke();
    g.restore();
    text(g, `★ ${rank}`, DESIGN_W / 2, 96, 10, "#ffd24f");
  }
}

function drawEnd(
  g: CanvasRenderingContext2D,
  state: PhotocardStackState,
  t: Translate,
): void {
  g.fillStyle = "rgba(5,1,15,.88)";
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);
  g.save();
  g.shadowColor = "#ff4fd8";
  g.shadowBlur = 18;
  text(g, t("game.photocard-stack.end.title"), DESIGN_W / 2, 190, 29);
  g.restore();
  const height = heightOf(state);
  const rank = t(`game.photocard-stack.rank.${rankIndexForHeight(height)}`);
  const lines = [
    `${t("game.photocard-stack.hud.height")}: ${height}`,
    `${t("game.photocard-stack.hud.score")}: ${state.score}`,
    `${t("game.photocard-stack.stat.rank")}: ${rank}`,
    `${t("game.photocard-stack.hud.best")}: ${state.bestHeight}`,
  ];
  lines.forEach((line, index) =>
    text(g, line, DESIGN_W / 2, 250 + index * 36, 14, "#ffd6f5"),
  );
}

export function renderPhotocardStack(
  g: CanvasRenderingContext2D,
  state: PhotocardStackState,
  images: PhotocardImages,
  particles: readonly StackParticle[],
  toast: StackToast | null,
  t: Translate,
): void {
  const gradient = g.createLinearGradient(0, 0, 0, DESIGN_H);
  gradient.addColorStop(0, "#241046");
  gradient.addColorStop(0.6, "#170a30");
  gradient.addColorStop(1, "#0a0318");
  g.fillStyle = gradient;
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);

  for (let i = 0; i < 28; i += 1) {
    const x = (i * 137) % DESIGN_W;
    const y = (i * 211 + state.cameraY * 0.3) % (DESIGN_H * 1.2);
    g.globalAlpha = 0.2 + (0.5 * ((i * 53) % 40)) / 40;
    g.fillStyle = i % 5 === 0 ? "#4ff0ff" : "#fff";
    g.fillRect(x, y, 1 + (i % 2), 1 + (i % 2));
  }
  g.globalAlpha = 1;

  g.save();
  g.translate(0, state.cameraY);
  state.stack.forEach((card, index) => {
    const screenY = card.y + state.cameraY;
    if (screenY < -cardHeight(card.w) || screenY > DESIGN_H + 40) return;
    drawCard(g, card, images, index === state.stack.length - 1);
  });
  if (state.status === "playing") drawCard(g, state.moving, images, true);
  for (const particle of particles) {
    if (particle.type !== "card") continue;
    const h = cardHeight(particle.card.w);
    g.save();
    g.globalAlpha = Math.max(0, particle.life / 1400);
    g.translate(particle.card.x + particle.card.w / 2, particle.card.y + h / 2);
    g.rotate(particle.rotation);
    drawCard(
      g,
      { ...particle.card, x: -particle.card.w / 2, y: -h / 2 },
      images,
      false,
    );
    g.restore();
  }
  g.restore();

  for (const particle of particles) {
    if (particle.type !== "spark") continue;
    g.globalAlpha = Math.max(0, particle.life / 650);
    g.fillStyle = particle.color;
    g.fillRect(
      particle.x,
      particle.y + state.cameraY,
      particle.size,
      particle.size,
    );
  }
  g.globalAlpha = 1;

  drawHud(g, state, t);
  if (state.status === "playing" && !state.hasDropped) {
    text(
      g,
      t("game.photocard-stack.tapHint"),
      DESIGN_W / 2,
      DESIGN_H - 58,
      16,
      "#ffd6f5",
    );
  }
  if (toast) {
    g.save();
    g.globalAlpha = Math.min(1, toast.life / 160);
    g.shadowColor = toast.color;
    g.shadowBlur = 20;
    text(g, toast.text, DESIGN_W / 2, 190, 24, toast.color);
    g.restore();
    g.globalAlpha = 1;
  }
  if (state.status === "over") drawEnd(g, state, t);

  g.save();
  const vignette = g.createRadialGradient(
    DESIGN_W / 2,
    DESIGN_H / 2,
    DESIGN_W * 0.45,
    DESIGN_W / 2,
    DESIGN_H / 2,
    DESIGN_H * 0.62,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,.48)");
  g.fillStyle = vignette;
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);
  g.fillStyle = "rgba(0,0,0,.075)";
  for (let y = 0; y < DESIGN_H; y += 4) g.fillRect(0, y, DESIGN_W, 2);
  g.restore();
}
