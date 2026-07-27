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
  /** Plush rows between the two aim depths — occludes a BACK-row claw. */
  midPlush: SpriteRect;
  /** Front plush rows — occlude the claw at either aim depth. */
  frontPlush: SpriteRect;
  frame: SpriteRect;
  trolley: SpriteRect;
  clawOpen: SpriteRect;
  clawClosed: SpriteRect;
  /** Authored wide-open claw for the win release (prize falls straight down). */
  clawRelease: SpriteRect;
  /** keyed by letter: D A E B A2 K (the aimable rows) */
  clawPlush: Record<string, SpriteRect>;
  /** Authored prize-fall frames, chute-top -> settled in the box. */
  fallFrames: SpriteRect[];
  winBoard: SpriteRect;
  /** TRY AGAIN! overlay for miss/slip outcomes. */
  tryAgain: SpriteRect;
  /** Daidai's SO CLOSE! board (delivered 2026-07-27). */
  soClose: SpriteRect;
  controls: Record<ControlKey, SpriteRect>;
}
