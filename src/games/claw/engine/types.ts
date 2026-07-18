export type Outcome = "win" | "miss" | "drop";

export type ControlKey = "left" | "right" | "forward" | "backward" | "drop";

export interface SpriteRect {
  src: string;
  /** top-left x in design space (manifest scale already applied) */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Manifest {
  scale: number;
  design: { w: number; h: number };
  back: SpriteRect;
  frontPlush: SpriteRect;
  frame: SpriteRect;
  trolley: SpriteRect;
  clawOpen: SpriteRect;
  clawClosed: SpriteRect;
  /** keyed by letter: D A E B A2 K excl */
  clawPlush: Record<string, SpriteRect>;
  winBoard: SpriteRect;
  controls: Record<ControlKey, SpriteRect>;
}
