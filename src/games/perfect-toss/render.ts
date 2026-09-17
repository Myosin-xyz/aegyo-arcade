import {
  DESIGN_H,
  DESIGN_W,
  PERFECT_FRAC,
  bonusCenter,
  markerPosition,
  type PerfectTossState,
  type TossResult,
} from "./logic";

export type PerfectTossAsset =
  | "boy_throw"
  | "boy_catch"
  | "boy_sad"
  | "boy_happy"
  | "girl_throw"
  | "girl_catch"
  | "girl_sad"
  | "girl_happy"
  | "lightstick";

export type PerfectTossImages = Record<PerfectTossAsset, HTMLImageElement>;

export interface TossParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  size: number;
  lifeTicks: number;
}

export interface TossToast {
  text: string;
  color: string;
  ticksRemaining: number;
}

export interface TossEffects {
  particles: readonly TossParticle[];
  toast: TossToast | null;
  shakeTicks: number;
}

type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

const FONT = '"Arial Black", "Trebuchet MS", system-ui, sans-serif';
const BAR_Y = DESIGN_H * 0.3;
const BAR_X0 = DESIGN_W * 0.12;
const BAR_X1 = DESIGN_W * 0.88;
const BAR_LENGTH = BAR_X1 - BAR_X0;

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

function drawSprite(
  g: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  targetHeight: number,
): void {
  if (!image.complete || image.naturalWidth === 0) return;
  const width = targetHeight * (image.naturalWidth / image.naturalHeight);
  g.drawImage(image, x - width / 2, y - targetHeight, width, targetHeight);
}

function poseFor(
  side: "boy" | "girl",
  state: PerfectTossState,
): PerfectTossAsset {
  if (state.reaction) {
    const mood = state.reaction.result === "miss" ? "sad" : "happy";
    return `${side}_${mood}` as PerfectTossAsset;
  }
  if (side === "boy") {
    return state.thrown && state.thrown.ageTicks < 12
      ? "boy_throw"
      : "boy_catch";
  }
  return state.thrown &&
    state.thrown.ageTicks > 18 &&
    state.thrown.result !== "miss"
    ? "girl_catch"
    : "girl_throw";
}

function drawBackground(g: CanvasRenderingContext2D): void {
  const gradient = g.createLinearGradient(0, 0, 0, DESIGN_H);
  gradient.addColorStop(0, "#241046");
  gradient.addColorStop(0.6, "#170a30");
  gradient.addColorStop(1, "#0a0318");
  g.fillStyle = gradient;
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);

  g.fillStyle = "#fff";
  for (let index = 0; index < 30; index += 1) {
    const x = (index * 137) % DESIGN_W;
    const y = (index * 233) % DESIGN_H;
    g.globalAlpha = 0.15 + (0.4 * ((index * 53) % 40)) / 40;
    g.fillRect(x, y, 1 + (index % 2), 1 + (index % 2));
  }
  g.globalAlpha = 1;
}

function drawHud(
  g: CanvasRenderingContext2D,
  state: PerfectTossState,
  t: Translate,
): void {
  const labels = [
    t("game.perfect-toss.hud.catches"),
    t("game.perfect-toss.hud.score"),
    t("game.perfect-toss.hud.best"),
  ];
  const values = [state.catches, state.score, state.bestScore];
  const gap = 8;
  const x0 = 12;
  const width = (DESIGN_W - x0 * 2 - gap * 2) / 3;
  for (let index = 0; index < labels.length; index += 1) {
    const x = x0 + index * (width + gap);
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
    text(g, labels[index].toUpperCase(), x + width / 2, 28, 8, "#4ff0ff");
    text(g, String(values[index]), x + width / 2, 50, 19);
  }
}

function drawTimingBar(
  g: CanvasRenderingContext2D,
  state: PerfectTossState,
): void {
  g.save();
  g.lineCap = "round";
  g.strokeStyle = "rgba(123,47,247,.5)";
  g.lineWidth = 10;
  g.beginPath();
  g.moveTo(BAR_X0, BAR_Y);
  g.lineTo(BAR_X1, BAR_Y);
  g.stroke();

  const zoneX0 = BAR_X0 + BAR_LENGTH * (state.zoneCenter - state.halfWidth);
  const zoneX1 = BAR_X0 + BAR_LENGTH * (state.zoneCenter + state.halfWidth);
  g.strokeStyle = "rgba(255,210,79,.95)";
  g.lineWidth = 14;
  g.shadowColor = "#ffd24f";
  g.shadowBlur = 10;
  g.beginPath();
  g.moveTo(zoneX0, BAR_Y);
  g.lineTo(zoneX1, BAR_Y);
  g.stroke();

  const perfectHalfWidth = state.halfWidth * PERFECT_FRAC;
  g.strokeStyle = "rgba(255,255,255,.95)";
  g.lineWidth = 6;
  g.shadowBlur = 6;
  g.beginPath();
  g.moveTo(BAR_X0 + BAR_LENGTH * (state.zoneCenter - perfectHalfWidth), BAR_Y);
  g.lineTo(BAR_X0 + BAR_LENGTH * (state.zoneCenter + perfectHalfWidth), BAR_Y);
  g.stroke();

  const center = bonusCenter(state);
  if (state.bonusZone && center !== null) {
    const x0 = BAR_X0 + BAR_LENGTH * (center - state.bonusZone.halfWidth);
    const x1 = BAR_X0 + BAR_LENGTH * (center + state.bonusZone.halfWidth);
    const pulse = 0.78 + 0.22 * Math.sin((state.tick / 60) * Math.PI * 4);
    g.strokeStyle = `rgba(90,255,160,${pulse})`;
    g.lineWidth = 9;
    g.shadowColor = "#5affa0";
    g.shadowBlur = 14;
    g.beginPath();
    g.moveTo(x0, BAR_Y - 16);
    g.lineTo(x1, BAR_Y - 16);
    g.stroke();
    text(g, "✦", (x0 + x1) / 2, BAR_Y - 27, 12, "#5affa0");
  }
  g.restore();

  if (
    !state.thrown ||
    state.thrown.ageTicks / state.thrown.durationTicks < 0.08
  ) {
    const x = BAR_X0 + BAR_LENGTH * markerPosition(state);
    g.save();
    g.shadowColor = "#ff4fd8";
    g.shadowBlur = 14;
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc(x, BAR_Y, 9, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#ff4fd8";
    g.beginPath();
    g.arc(x, BAR_Y, 5, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}

function resultColor(result: TossResult): string {
  if (result === "perfect") return "#ffd24f";
  if (result === "good") return "#4ff0ff";
  return "#ff5a7a";
}

function drawFlyingLightstick(
  g: CanvasRenderingContext2D,
  state: PerfectTossState,
  images: PerfectTossImages,
): void {
  const active = state.thrown;
  if (!active) return;
  const scale = DESIGN_W * 0.09;
  const characterHeight = scale * 3.6;
  const idolX = DESIGN_W * 0.16;
  const idolY = DESIGN_H * 0.72;
  const fanX = DESIGN_W * 0.84;
  const fanY = DESIGN_H * 0.72;
  const idolWidth =
    characterHeight *
    (images.boy_throw.naturalWidth / images.boy_throw.naturalHeight);
  const fanWidth =
    characterHeight *
    (images.girl_catch.naturalWidth / images.girl_catch.naturalHeight);
  const releaseX = idolX + idolWidth * (0.995 - 0.5);
  const releaseY = idolY - characterHeight * (1 - 0.322);
  const landX = fanX + fanWidth * (0.159 - 0.5);
  const landY = fanY;
  const progress = Math.min(1, active.ageTicks / active.durationTicks);
  const missPenalty =
    active.result === "miss" ? active.offset * DESIGN_W * 0.5 : 0;
  const x =
    releaseX +
    (landX - releaseX) * progress +
    missPenalty * Math.max(0, progress - 0.5) * 2;
  const y =
    releaseY +
    (landY - releaseY) * progress -
    Math.sin(Math.PI * progress) * DESIGN_H * 0.22;

  const image = images.lightstick;
  if (!image.complete || image.naturalWidth === 0) return;
  const width = scale * 0.55;
  const height = width * (image.naturalHeight / image.naturalWidth);
  g.save();
  g.translate(x, y);
  g.rotate(progress * Math.PI * 4);
  g.shadowColor = resultColor(active.result);
  g.shadowBlur = 10;
  g.drawImage(image, -width / 2, -height / 2, width, height);
  g.restore();
}

function drawEnd(
  g: CanvasRenderingContext2D,
  state: PerfectTossState,
  t: Translate,
): void {
  g.fillStyle = "rgba(5,1,15,.88)";
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);
  g.save();
  g.shadowColor = "#ff4fd8";
  g.shadowBlur = 18;
  text(g, t("game.perfect-toss.end.title"), DESIGN_W / 2, 210, 31);
  g.restore();
  text(
    g,
    `${t("game.perfect-toss.hud.catches")}: ${state.catches}`,
    DESIGN_W / 2,
    275,
    16,
    "#ffd6f5",
  );
  text(
    g,
    `${t("game.perfect-toss.hud.score")}: ${state.score}`,
    DESIGN_W / 2,
    315,
    16,
    "#ffd6f5",
  );
  text(
    g,
    `${t("game.perfect-toss.hud.best")}: ${state.bestScore}`,
    DESIGN_W / 2,
    355,
    16,
    "#ffd6f5",
  );
}

export function renderPerfectToss(
  g: CanvasRenderingContext2D,
  state: PerfectTossState,
  images: PerfectTossImages,
  effects: TossEffects,
  t: Translate,
): void {
  const shake = effects.shakeTicks > 0 ? effects.shakeTicks / 24 : 0;
  const shakeX = shake ? Math.sin(state.tick * 7.1) * 5 * shake : 0;
  const shakeY = shake ? Math.cos(state.tick * 5.3) * 4 * shake : 0;
  g.save();
  g.translate(shakeX, shakeY);
  drawBackground(g);
  drawHud(g, state, t);
  drawTimingBar(g, state);

  const scale = DESIGN_W * 0.09;
  drawSprite(
    g,
    images[poseFor("boy", state)],
    DESIGN_W * 0.16,
    DESIGN_H * 0.72,
    scale * 3.6,
  );
  drawSprite(
    g,
    images[poseFor("girl", state)],
    DESIGN_W * 0.84,
    DESIGN_H * 0.72,
    scale * 3.6,
  );
  drawFlyingLightstick(g, state, images);

  for (const particle of effects.particles) {
    g.globalAlpha = Math.max(0, particle.lifeTicks / 42);
    g.fillStyle = particle.color;
    g.beginPath();
    g.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  g.restore();

  if (effects.toast) {
    const alpha = Math.min(1, effects.toast.ticksRemaining / 10);
    g.save();
    g.globalAlpha = alpha;
    g.shadowColor = effects.toast.color;
    g.shadowBlur = 18;
    text(g, effects.toast.text, DESIGN_W / 2, 145, 23, effects.toast.color);
    g.restore();
  }
  if (state.status === "playing" && state.catches === 0 && !state.thrown) {
    text(
      g,
      t("game.perfect-toss.tapHint"),
      DESIGN_W / 2,
      DESIGN_H - 52,
      15,
      "#ffd6f5",
    );
  }
  if (state.status === "over") drawEnd(g, state, t);

  // Lightweight CRT treatment from the delivery, without extra DOM layers.
  g.save();
  g.globalAlpha = 0.1;
  g.fillStyle = "#000";
  for (let y = 0; y < DESIGN_H; y += 4) g.fillRect(0, y, DESIGN_W, 2);
  g.globalAlpha = 1;
  const vignette = g.createRadialGradient(
    DESIGN_W / 2,
    DESIGN_H / 2,
    DESIGN_W * 0.2,
    DESIGN_W / 2,
    DESIGN_H / 2,
    DESIGN_H * 0.65,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,.5)");
  g.fillStyle = vignette;
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);
  g.restore();
}
