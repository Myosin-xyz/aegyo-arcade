/**
 * Canvas surface management (TECH_SPEC §6.3): the shell owns CSS/backing
 * size, the design-box transform, resize, and the effective-DPR cap. Games
 * draw exclusively in design-box coordinates.
 */

const DPR_CAP = 2;

export interface DesignBox {
  w: number;
  h: number;
}

export class CanvasSurfaceManager {
  private readonly onResize: () => void;
  private readonly onScroll: () => void;
  private cssWidth = 0;
  private cssHeight = 0;
  private offsetX = 0;
  private offsetY = 0;
  private scale = 1;
  private destroyed = false;
  /**
   * Cached canvas viewport rect for toDesign(): getBoundingClientRect()
   * forces a synchronous layout, and toDesign() runs on every pointer
   * event (including `move` during a drag). The rect only changes on
   * layout (resize) or when the page/viewport scrolls, so we refresh it on
   * exactly those signals instead of reading it per event.
   */
  private canvasRect: DOMRect | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly container: HTMLElement,
    private readonly designBox: DesignBox,
  ) {
    this.onResize = () => this.resize();
    this.onScroll = () => this.refreshCanvasRect();
    window.addEventListener("resize", this.onResize);
    // Scrolling shifts the canvas's viewport-relative rect without firing
    // a resize, so the cached rect must be refreshed on scroll too or
    // pointer mapping drifts. Passive: we only read layout, never block.
    window.addEventListener("scroll", this.onScroll, { passive: true });
    // visualViewport is the robust signal on mobile (pinch-zoom, URL-bar
    // collapse) where window scroll/resize can miss the change.
    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener("resize", this.onScroll, { passive: true });
      vv.addEventListener("scroll", this.onScroll, { passive: true });
    }
    this.resize();
  }

  /** Fit the design box inside the container, letterboxing extremes. */
  resize(): void {
    if (this.destroyed) return;
    const rect = this.container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const fit = Math.min(
      rect.width / this.designBox.w,
      rect.height / this.designBox.h,
    );
    this.cssWidth = Math.floor(this.designBox.w * fit);
    this.cssHeight = Math.floor(this.designBox.h * fit);
    this.scale = fit;
    this.offsetX = (rect.width - this.cssWidth) / 2;
    this.offsetY = (rect.height - this.cssHeight) / 2;

    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    this.canvas.style.width = `${this.cssWidth}px`;
    this.canvas.style.height = `${this.cssHeight}px`;
    // Apply the letterbox centering the offsets describe (M0 review P2).
    this.canvas.style.position = "absolute";
    this.canvas.style.left = `${this.offsetX}px`;
    this.canvas.style.top = `${this.offsetY}px`;
    this.canvas.width = Math.round(this.cssWidth * dpr);
    this.canvas.height = Math.round(this.cssHeight * dpr);

    const ctx = this.canvas.getContext("2d");
    if (ctx) {
      ctx.setTransform(
        (dpr * this.cssWidth) / this.designBox.w,
        0,
        0,
        (dpr * this.cssHeight) / this.designBox.h,
        0,
        0,
      );
    }

    // The canvas box/position just changed — refresh the cached rect so
    // toDesign() maps against the new layout.
    this.refreshCanvasRect();
  }

  /** Re-read and cache the canvas viewport rect (the one forced-layout
   * read, now bounded to resize/scroll instead of every pointer event). */
  private refreshCanvasRect(): void {
    if (this.destroyed) return;
    this.canvasRect = this.canvas.getBoundingClientRect();
  }

  /** Map viewport client coordinates into design-box coordinates. */
  toDesign(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvasRect ?? this.canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / (rect.width || 1)) * this.designBox.w,
      y: ((clientY - rect.top) / (rect.height || 1)) * this.designBox.h,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener("resize", this.onResize);
    window.removeEventListener("scroll", this.onScroll);
    const vv = window.visualViewport;
    if (vv) {
      vv.removeEventListener("resize", this.onScroll);
      vv.removeEventListener("scroll", this.onScroll);
    }
  }
}
