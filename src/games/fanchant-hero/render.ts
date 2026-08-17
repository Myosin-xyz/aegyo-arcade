import {
  BEAT_MS,
  DESIGN_H,
  DESIGN_W,
  LANES,
  SONG_BEATS,
  accuracyOf,
  approachMsForBeat,
  gradeForAccuracy,
  type FanchantState,
  type GoodieKey,
  type Judgement,
} from "./logic";

export type GoodieImages = Record<GoodieKey, HTMLImageElement>;

export type FanchantParticle =
  | {
      type: "spark";
      x: number;
      y: number;
      vx: number;
      vy: number;
      color: string;
      size: number;
      life: number;
    }
  | {
      type: "heart";
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
    };

export interface JudgementToast {
  kind: Judgement | "missed";
  color: string;
  life: number;
}

type Translate = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

const LANE_COLORS = ["#ff4fd8", "#4ff0ff", "#c9a0ff", "#ffd24f"];
const FONT = '"Arial Black", "Trebuchet MS", system-ui, sans-serif';

export function fieldX(): number {
  return DESIGN_W * 0.08;
}

export function fieldWidth(): number {
  return DESIGN_W * 0.84;
}

export function laneWidth(): number {
  return fieldWidth() / LANES;
}

export function laneAtX(x: number): number | null {
  const lane = Math.floor((x - fieldX()) / laneWidth());
  return lane >= 0 && lane < LANES ? lane : null;
}

function laneX(lane: number): number {
  return fieldX() + lane * laneWidth();
}

function hitLine(): number {
  return DESIGN_H * 0.8;
}

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

function text(
  g: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  size: number,
  color = "#fff",
): void {
  g.save();
  g.font = `900 ${size}px ${FONT}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = color;
  g.fillText(value, x, y);
  g.restore();
}

function drawHeart(g: CanvasRenderingContext2D, x: number, y: number): void {
  const pattern = [
    [1, 0, 1],
    [1, 1, 1],
    [0, 1, 0],
  ];
  g.fillStyle = "#ff4fd8";
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 3; col += 1) {
      if (pattern[row][col])
        g.fillRect(x + (col - 1.5) * 4, y + (row - 1.5) * 4, 4, 4);
    }
  }
}

function drawHud(
  g: CanvasRenderingContext2D,
  state: FanchantState,
  t: Translate,
): void {
  const labels = [
    t("game.fanchant-hero.hud.score"),
    t("game.fanchant-hero.hud.combo"),
    t("game.fanchant-hero.hud.accuracy"),
  ];
  const values = [
    String(state.score),
    String(state.combo),
    `${accuracyOf(state)}%`,
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
    text(g, values[i], x + width / 2, 50, i === 2 ? 16 : 19);
  }
}

function drawEnd(
  g: CanvasRenderingContext2D,
  state: FanchantState,
  t: Translate,
): void {
  const accuracy = accuracyOf(state);
  const grade = gradeForAccuracy(accuracy);
  g.fillStyle = "rgba(5,1,15,.9)";
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);
  g.save();
  g.shadowColor = accuracy >= 88 ? "#ffd24f" : "#ff4fd8";
  g.shadowBlur = 20;
  text(
    g,
    t(
      accuracy >= 88
        ? "game.fanchant-hero.end.encore"
        : "game.fanchant-hero.end.show",
    ),
    DESIGN_W / 2,
    172,
    29,
  );
  g.restore();
  text(g, grade, DESIGN_W / 2, 238, 58, "#ffd24f");
  const lines = [
    `${t("game.fanchant-hero.hud.score")}: ${state.score}`,
    `${t("game.fanchant-hero.stat.maxCombo")}: ${state.maxCombo}`,
    `${t("game.fanchant-hero.hud.accuracy")}: ${accuracy}%`,
  ];
  lines.forEach((line, index) =>
    text(g, line, DESIGN_W / 2, 315 + index * 38, 14, "#ffd6f5"),
  );
}

export function renderFanchantHero(
  g: CanvasRenderingContext2D,
  state: FanchantState,
  images: GoodieImages,
  laneFlash: readonly number[],
  particles: readonly FanchantParticle[],
  judgement: JudgementToast | null,
  t: Translate,
): void {
  const background = g.createLinearGradient(0, 0, 0, DESIGN_H);
  background.addColorStop(0, "#241046");
  background.addColorStop(0.6, "#170a30");
  background.addColorStop(1, "#0a0318");
  g.fillStyle = background;
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);

  const fx = fieldX();
  const fw = fieldWidth();
  const lw = laneWidth();
  const lineY = hitLine();
  for (let lane = 0; lane < LANES; lane += 1) {
    const x = laneX(lane);
    g.fillStyle =
      lane % 2 === 0 ? "rgba(123,47,247,.16)" : "rgba(123,47,247,.1)";
    g.fillRect(x, 0, lw, DESIGN_H);
    if (laneFlash[lane] > 0.02) {
      g.fillStyle = `rgba(255,79,216,${laneFlash[lane] * 0.25})`;
      g.fillRect(x, 0, lw, DESIGN_H);
    }
    g.strokeStyle = "rgba(79,240,255,.15)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, DESIGN_H);
    g.stroke();
  }
  g.beginPath();
  g.moveTo(fx + fw, 0);
  g.lineTo(fx + fw, DESIGN_H);
  g.stroke();

  g.save();
  g.shadowColor = "#4ff0ff";
  g.shadowBlur = 12;
  g.strokeStyle = "#4ff0ff";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(fx, lineY);
  g.lineTo(fx + fw, lineY);
  g.stroke();
  g.restore();
  for (let lane = 0; lane < LANES; lane += 1) {
    const x = laneX(lane) + lw / 2;
    g.save();
    g.strokeStyle = LANE_COLORS[lane];
    g.lineWidth = 3;
    g.globalAlpha = 0.5 + laneFlash[lane] * 0.5;
    g.beginPath();
    g.arc(x, lineY, lw * 0.34, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  if (state.status === "playing") {
    for (const note of state.notes) {
      if (note.status !== "pending") continue;
      const delta = note.beat * BEAT_MS - state.elapsedMs;
      const approach = approachMsForBeat(note.beat);
      if (delta > approach || delta < -220) continue;
      const progress = 1 - delta / approach;
      const y = lineY * progress;
      const x = laneX(note.lane) + lw / 2;
      const image = images[note.goodie];
      const width = lw * 0.62;
      g.save();
      g.shadowColor = LANE_COLORS[note.lane];
      g.shadowBlur = 14;
      g.translate(x, y);
      g.rotate(Math.sin(note.beat * 1.7 + progress * Math.PI * 2) * 0.22);
      if (image?.complete && image.naturalWidth > 0) {
        const height = width * (image.naturalHeight / image.naturalWidth);
        g.drawImage(image, -width / 2, -height / 2, width, height);
      } else {
        g.fillStyle = LANE_COLORS[note.lane];
        g.beginPath();
        g.arc(0, 0, lw * 0.3, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    }
  }

  for (const particle of particles) {
    g.globalAlpha = Math.max(0, particle.life / 650);
    if (particle.type === "heart") drawHeart(g, particle.x, particle.y);
    else {
      g.fillStyle = particle.color;
      g.fillRect(particle.x, particle.y, particle.size, particle.size);
    }
  }
  g.globalAlpha = 1;

  drawHud(g, state, t);
  if (state.combo >= 2 && state.status === "playing") {
    text(g, String(state.combo), DESIGN_W / 2, 170, 48, "#ffd24f");
    text(
      g,
      t("game.fanchant-hero.hud.combo"),
      DESIGN_W / 2,
      202,
      12,
      "#4ff0ff",
    );
  }
  if (judgement) {
    g.save();
    g.globalAlpha = Math.min(1, judgement.life / 120);
    g.shadowColor = judgement.color;
    g.shadowBlur = 18;
    text(
      g,
      t(`game.fanchant-hero.judge.${judgement.kind}`),
      DESIGN_W / 2,
      384,
      25,
      judgement.color,
    );
    g.restore();
  }

  if (state.status === "playing") {
    const progress = Math.max(
      0,
      Math.min(1, state.elapsedMs / (SONG_BEATS * BEAT_MS)),
    );
    g.fillStyle = "rgba(255,255,255,.12)";
    g.fillRect(fx, DESIGN_H - 16, fw, 4);
    g.fillStyle = "#ff4fd8";
    g.fillRect(fx, DESIGN_H - 16, fw * progress, 4);
    if (state.elapsedMs < 0) {
      const count = Math.max(1, Math.ceil(-state.elapsedMs / BEAT_MS));
      text(g, String(count), DESIGN_W / 2, 292, 42, "#ffd24f");
    }
  } else {
    drawEnd(g, state, t);
  }

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
