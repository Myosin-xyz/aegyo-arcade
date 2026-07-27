import type { SpriteRect } from "./types";

export interface Viewport {
  cssW: number;
  cssH: number;
  /** backing pixels per design pixel (already folds in devicePixelRatio) */
  scale: number;
  dpr: number;
}

// Owns canvas sizing + the design→backing transform. DPR-aware: the backing store
// is sized to css * devicePixelRatio so a downscaled asset still resolves crisply,
// and smoothing is OFF so the scaling reads as intentional pixel art, not blur.
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;
  vp: Viewport = { cssW: 0, cssH: 0, scale: 1, dpr: 1 };

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly design: { w: number; h: number },
    private readonly stage: HTMLElement,
  ) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.resize();
  }

  resize(): void {
    const { w: dw, h: dh } = this.design;
    // Cap DPR at 2 — enough for crisp at our asset resolution, and keeps the
    // backing store (a tall portrait) cheap to fill on mobile.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const availW = this.stage.clientWidth;
    const availH = this.stage.clientHeight;
    const fit = Math.min(availW / dw, availH / dh);
    const cssW = Math.max(1, Math.floor(dw * fit));
    const cssH = Math.max(1, Math.floor(dh * fit));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.vp = { cssW, cssH, scale: this.canvas.width / dw, dpr };
    this.ctx.imageSmoothingEnabled = false;
  }

  /** Map a client (pointer) coordinate into design space. */
  toDesign(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const s = rect.width / this.design.w;
    return { x: (clientX - rect.left) / s, y: (clientY - rect.top) / s };
  }

  /**
   * `scale` shrinks/grows around the sprite's TOP-CENTER: x stays centred
   * and the top edge stays put — chosen for the claw, which hangs from a
   * cable anchored at its top (a centred or top-left origin would detach
   * the sprite from its cable as it scales).
   */
  blit(
    img: HTMLImageElement,
    rect: SpriteRect,
    dx = 0,
    dy = 0,
    alpha = 1,
    scale = 1,
  ): void {
    if (alpha !== 1) this.ctx.globalAlpha = alpha;
    if (scale === 1) {
      this.ctx.drawImage(img, rect.x + dx, rect.y + dy, rect.w, rect.h);
    } else {
      this.ctx.drawImage(
        img,
        rect.x + dx + (rect.w * (1 - scale)) / 2,
        rect.y + dy,
        rect.w * scale,
        rect.h * scale,
      );
    }
    if (alpha !== 1) this.ctx.globalAlpha = 1;
  }
}
