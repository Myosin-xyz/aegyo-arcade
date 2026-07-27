/**
 * Bias Flap renderer — pure draw over FlappyState.
 *
 * Ports the delivery's canvas scene: cover-fit city night, lightstick
 * pairs with procedurally extended shafts, the tilting hero, and her
 * heart trail. The delivery's DOM overlays (HUD, tap hint, toast, level/
 * quit/win screens) become canvas draws here; its CSS CRT/vignette page
 * chrome is NOT ported (same call as Snake Freebies — the shell owns the
 * page look).
 */

import {
  DESIGN_H,
  DESIGN_W,
  HERO_H,
  HERO_W,
  HERO_X,
  LEVELS,
  STICK_H,
  STICK_SRC,
  STICK_W,
  formatTime,
  levelSpec,
  type FlappyState,
} from "./logic";

export { DESIGN_H, DESIGN_W };

export interface FlappyImages {
  bg: HTMLImageElement;
  hero: HTMLImageElement;
  heart: HTMLImageElement;
  stickUp: HTMLImageElement;
  stickDown: HTMLImageElement;
}

/** Cosmetic heart particle (module-owned; rules-inert). */
export interface Heart {
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: number;
  a: number;
}

type Translate = (key: string, params?: Record<string, string>) => string;

/** The ⏹ leave (cash-out) zone, top-right. 72×54 design px ≈ 60×45 CSS
 * at the height-limited 320×568 floor — clear of the 44px minimum. */
export function leaveRect(): { x: number; y: number; w: number; h: number } {
  return { x: DESIGN_W - 84, y: 12, w: 72, h: 54 };
}

/** Tap zones of the quit-confirm overlay (keep on top, leave below). */
export function quitConfirmRects(): {
  keep: { x: number; y: number; w: number; h: number };
  leave: { x: number; y: number; w: number; h: number };
} {
  return {
    keep: { x: 60, y: 330, w: 240, h: 56 },
    leave: { x: 60, y: 402, w: 240, h: 56 },
  };
}

function roundedRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  g.beginPath();
  if (typeof g.roundRect === "function") g.roundRect(x, y, w, h, r);
  else g.rect(x, y, w, h);
}

function drawCoverBg(g: CanvasRenderingContext2D, img: HTMLImageElement): void {
  if (!img.naturalWidth) {
    g.fillStyle = "#0a0318";
    g.fillRect(0, 0, DESIGN_W, DESIGN_H);
    return;
  }
  const s = Math.max(DESIGN_W / img.naturalWidth, DESIGN_H / img.naturalHeight);
  const w = img.naturalWidth * s;
  const h = img.naturalHeight * s;
  g.drawImage(img, (DESIGN_W - w) / 2, (DESIGN_H - h) / 2, w, h);
}

/** One stick pair: sprites at the gap edges, shafts extended to the
 * screen edges with a thin slice from the sprite (delivery technique). */
function drawStickPair(
  g: CanvasRenderingContext2D,
  images: FlappyImages,
  o: { x: number; gapTop: number; gapBot: number },
): void {
  const sw = STICK_W;
  const sh = STICK_H;
  const x0 = o.x - sw / 2;
  const shaftW =
    (sw * (STICK_SRC.shaftX1 - STICK_SRC.shaftX0 + 8)) / STICK_SRC.w;
  const shaftX = o.x - shaftW / 2;

  // Top stick (orb at its bottom): sprite bottom sits at gapTop.
  g.drawImage(images.stickDown, x0, o.gapTop - sh, sw, sh);
  if (o.gapTop - sh > 0 && images.stickDown.naturalWidth) {
    g.drawImage(
      images.stickDown,
      STICK_SRC.shaftX0 - 4,
      2,
      STICK_SRC.shaftX1 - STICK_SRC.shaftX0 + 8,
      6,
      shaftX,
      0,
      shaftW,
      o.gapTop - sh + 2,
    );
  }
  // Bottom stick (orb at its top): sprite top sits at gapBot.
  g.drawImage(images.stickUp, x0, o.gapBot, sw, sh);
  if (o.gapBot + sh < DESIGN_H && images.stickUp.naturalWidth) {
    g.drawImage(
      images.stickUp,
      STICK_SRC.shaftX0 - 4,
      STICK_SRC.h - 8,
      STICK_SRC.shaftX1 - STICK_SRC.shaftX0 + 8,
      6,
      shaftX,
      o.gapBot + sh - 2,
      shaftW,
      DESIGN_H - (o.gapBot + sh) + 2,
    );
  }
}

function drawHud(
  g: CanvasRenderingContext2D,
  state: FlappyState,
  t: Translate,
): void {
  const cells: [string, string][] = [
    [t("game.flappy.hud.level"), `${state.level + 1}/${LEVELS.length}`],
    [t("game.flappy.hud.gates"), `${state.gates}/${levelSpec(state).gates}`],
    [t("game.flappy.hud.time"), formatTime(state.elapsedMs)],
  ];
  const boxW = 82;
  cells.forEach(([label, value], i) => {
    const x = 12 + i * (boxW + 6);
    g.fillStyle = "rgba(20, 8, 40, 0.85)";
    roundedRect(g, x, 14, boxW, 40, 8);
    g.fill();
    g.strokeStyle = "rgba(255, 143, 184, 0.3)";
    g.lineWidth = 1;
    g.stroke();
    g.textBaseline = "middle";
    g.textAlign = "left";
    g.fillStyle = "#b9a8e0";
    g.font = "700 9px system-ui, sans-serif";
    g.fillText(label.toUpperCase(), x + 8, 26);
    g.fillStyle = "#ffffff";
    g.font = "800 14px system-ui, sans-serif";
    g.fillText(value, x + 8, 43);
  });

  // ⏹ leave button (cash-out) — always visible while a run is live.
  const r = leaveRect();
  g.fillStyle = "rgba(20, 8, 40, 0.85)";
  roundedRect(g, r.x, r.y, r.w, r.h, 10);
  g.fill();
  g.strokeStyle = "rgba(255, 143, 184, 0.45)";
  g.stroke();
  g.fillStyle = "#ff8fb8";
  g.font = "800 11px system-ui, sans-serif";
  g.textAlign = "center";
  g.fillText(t("game.flappy.leave").toUpperCase(), r.x + r.w / 2, r.y + 22);
  g.fillStyle = "#ffffff";
  g.fillRect(r.x + r.w / 2 - 6, r.y + 32, 12, 12);
}

function overlayScrim(g: CanvasRenderingContext2D): void {
  g.fillStyle = "rgba(10, 3, 24, 0.88)";
  g.fillRect(0, 0, DESIGN_W, DESIGN_H);
}

function centeredLines(
  g: CanvasRenderingContext2D,
  lines: [string, string, number][],
): void {
  g.textAlign = "center";
  g.textBaseline = "middle";
  for (const [text, style, y] of lines) {
    const [color, font] = style.split("|");
    g.fillStyle = color;
    g.font = font;
    g.fillText(text, DESIGN_W / 2, y);
  }
}

export function renderFlappy(
  g: CanvasRenderingContext2D,
  state: FlappyState,
  images: FlappyImages,
  hearts: readonly Heart[],
  t: Translate,
  /** transient crash toast, module-owned */
  toast: string | null,
): void {
  g.clearRect(0, 0, DESIGN_W, DESIGN_H);
  drawCoverBg(g, images.bg);

  // Hearts behind the hero (delivery order).
  for (const h of hearts) {
    g.globalAlpha = Math.max(h.a, 0);
    g.drawImage(
      images.heart,
      h.x - h.s / 2,
      h.y - h.s / 2,
      h.s,
      h.s * (61 / 80),
    );
  }
  g.globalAlpha = 1;

  for (const o of state.obstacles) drawStickPair(g, images, o);

  // Hero with velocity tilt (delivery: clamp(vy·0.035, −0.45, 0.6)).
  const tilt = Math.max(-0.45, Math.min(0.6, state.heroVy * 0.035));
  g.save();
  g.translate(HERO_X, state.heroY);
  g.rotate(tilt);
  g.drawImage(images.hero, -HERO_W / 2, -HERO_H / 2, HERO_W, HERO_H);
  g.restore();

  drawHud(g, state, t);

  if (toast) {
    g.fillStyle = "rgba(20, 8, 40, 0.9)";
    const w = Math.max(180, toast.length * 9 + 40);
    roundedRect(g, (DESIGN_W - w) / 2, 88, w, 36, 10);
    g.fill();
    centeredLines(g, [[toast, "#ffd166|800 13px system-ui, sans-serif", 106]]);
  }

  if (state.status === "waiting") {
    centeredLines(g, [
      [
        t("game.flappy.tapHint").toUpperCase(),
        "#7dffd9|800 15px system-ui, sans-serif",
        DESIGN_H * 0.68,
      ],
    ]);
  }

  if (state.status === "levelBreak") {
    overlayScrim(g);
    centeredLines(g, [
      [
        t(`game.flappy.phrase.${state.level + 1}`).toUpperCase(),
        "#ffd166|800 13px system-ui, sans-serif",
        DESIGN_H * 0.38,
      ],
      [
        t("game.flappy.levelUp", { level: String(state.level + 2) }),
        "#ffffff|800 26px system-ui, sans-serif",
        DESIGN_H * 0.45,
      ],
      [
        t("game.flappy.nextGoal", {
          count: String(LEVELS[state.level + 1].gates),
        }),
        "#b9a8e0|600 14px system-ui, sans-serif",
        DESIGN_H * 0.51,
      ],
      [
        t("game.flappy.tapToGo"),
        "#7dffd9|700 15px system-ui, sans-serif",
        DESIGN_H * 0.58,
      ],
    ]);
  }

  if (state.status === "quitConfirm") {
    overlayScrim(g);
    const zones = quitConfirmRects();
    centeredLines(g, [
      [
        t("game.flappy.quitTitle"),
        "#ffffff|800 24px system-ui, sans-serif",
        DESIGN_H * 0.36,
      ],
      [
        t("game.flappy.quitBody"),
        "#b9a8e0|600 12px system-ui, sans-serif",
        DESIGN_H * 0.42,
      ],
    ]);
    for (const [zone, label, accent, keyHint] of [
      [zones.keep, t("game.flappy.keepFlying"), "#7dffd9", "ESC"],
      [zones.leave, t("game.flappy.leaveSave"), "#ff8fb8", "ENTER"],
    ] as const) {
      g.fillStyle = "rgba(43, 17, 70, 0.9)";
      roundedRect(g, zone.x, zone.y, zone.w, zone.h, 12);
      g.fill();
      g.strokeStyle = accent;
      g.lineWidth = 2;
      g.stroke();
      centeredLines(g, [
        [
          label.toUpperCase(),
          `${accent}|800 15px system-ui, sans-serif`,
          zone.y + zone.h / 2 - 4,
        ],
        // Key names are universal, not locale copy — drawn literally so
        // keyboard players can see their route (review P2).
        [
          keyHint,
          "rgba(185,168,224,0.75)|700 9px system-ui, sans-serif",
          zone.y + zone.h - 12,
        ],
      ]);
    }
  }

  // Terminal screens stay in-canvas (endPresentation "game-authored"):
  // the host adds only Play Again + the Challenge CTA below.
  if (state.status === "won" || state.status === "cashedOut") {
    overlayScrim(g);
    const won = state.status === "won";
    // Two-line titles as TWO keys (canvas fillText does not wrap; "SEE
    // YOU AT THE NEXT SHOW!" overflows the 360px box on one line and the
    // delivery breaks it the same way — and the l10n review pack is a
    // markdown TABLE, so locale values must stay newline-free).
    const titleKey = won ? "game.flappy.winTitle" : "game.flappy.endTitle";
    const titleLines = [t(`${titleKey}.1`), t(`${titleKey}.2`)];
    centeredLines(
      g,
      titleLines.map((line, i): [string, string, number] => [
        line,
        "#ffffff|800 26px system-ui, sans-serif",
        DESIGN_H * (0.27 + i * 0.055),
      ]),
    );
    centeredLines(g, [
      [
        t(won ? "game.flappy.winSub" : "game.flappy.endSub"),
        "#7dffd9|800 12px system-ui, sans-serif",
        DESIGN_H * 0.37,
      ],
      [
        `${t("game.flappy.stat.score")}: ${state.score}`,
        "#ffd6f5|800 16px system-ui, sans-serif",
        DESIGN_H * 0.45,
      ],
      [
        `${t("game.flappy.stat.gates")}: ${state.totalGates}`,
        "#ffd6f5|800 16px system-ui, sans-serif",
        DESIGN_H * 0.5,
      ],
      [
        `${t("game.flappy.stat.time")}: ${formatTime(state.elapsedMs)}`,
        "#ffd6f5|800 16px system-ui, sans-serif",
        DESIGN_H * 0.55,
      ],
    ]);
  }
}
