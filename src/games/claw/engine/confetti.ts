// Code-drawn confetti for the win moment, on top of the baked confetti in the
// win board. Coordinates are design-space; speeds are per-millisecond.

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  life: number;
  maxLife: number;
}

const COLORS = [
  "#ff5d8f",
  "#ffd23f",
  "#3ad6c8",
  "#7c5cff",
  "#54e36b",
  "#ff8a3d",
];

export class Confetti {
  private ps: Particle[] = [];

  clear(): void {
    this.ps.length = 0;
  }

  burst(cx: number, cy: number, count: number, speed: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.ps.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - speed * 0.7,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.4,
        w: 8 + Math.random() * 16,
        h: 6 + Math.random() * 12,
        color: COLORS[(Math.random() * COLORS.length) | 0] ?? "#fff",
        life: 0,
        maxLife: 1400 + Math.random() * 1400,
      });
    }
  }

  /** Dusty impact burst — used when the plush slips and lands back on the pile,
   *  so the drop reads as a thud rather than a sprite swap. */
  puff(cx: number, cy: number, count: number): void {
    const dust = ["#cdbfe6", "#9b8cc7", "#e8e0f5", "#b7a9d6"];
    for (let i = 0; i < count; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI;
      const sp = 0.3 + Math.random() * 0.6;
      this.ps.push({
        x: cx,
        y: cy,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        w: 6 + Math.random() * 8,
        h: 6 + Math.random() * 8,
        color: dust[(Math.random() * dust.length) | 0] ?? "#fff",
        life: 0,
        maxLife: 450 + Math.random() * 350,
      });
    }
  }

  update(dt: number, gravity: number): void {
    for (const p of this.ps) {
      p.life += dt;
      p.vy += gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr;
    }
    this.ps = this.ps.filter((p) => p.life < p.maxLife);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const p of this.ps) {
      const a = 1 - p.life / p.maxLife;
      ctx.save();
      ctx.globalAlpha = a < 0 ? 0 : a;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
  }

  get active(): boolean {
    return this.ps.length > 0;
  }
}
