/**
 * On-screen direction controls (docs/games/snake.md: "swipe and visible
 * direction controls" — M2 review P1). Pure geometry so hit mapping is
 * unit-testable; the module renders and routes input through these zones.
 *
 * Cross layout in the 360×640 design box, below the 360×360 board
 * (board occupies y 140–500).
 */

import type { Dir } from "./logic";

export interface ControlZone {
  dir: Dir;
  x: number;
  y: number;
  w: number;
  h: number;
}

const SIZE = 56;
const HIT_PAD = 10; // forgiving touch targets (44px+ effective)

export const CONTROL_ZONES: ControlZone[] = [
  { dir: "up", x: 152, y: 508, w: SIZE, h: SIZE },
  { dir: "left", x: 84, y: 540, w: SIZE, h: SIZE },
  { dir: "right", x: 220, y: 540, w: SIZE, h: SIZE },
  { dir: "down", x: 152, y: 572, w: SIZE, h: SIZE },
];

/**
 * Map a design-space point to a control direction, if any. Padded zones
 * overlap at the cross's inner corners, so ties resolve to the NEAREST
 * zone center — a tap always means the button it's closest to.
 */
export function hitControl(x: number, y: number): Dir | null {
  let bestDir: Dir | null = null;
  let bestDistance = Infinity;
  for (const zone of CONTROL_ZONES) {
    const inside =
      x >= zone.x - HIT_PAD &&
      x <= zone.x + zone.w + HIT_PAD &&
      y >= zone.y - HIT_PAD &&
      y <= zone.y + zone.h + HIT_PAD;
    if (!inside) continue;
    const cx = zone.x + zone.w / 2;
    const cy = zone.y + zone.h / 2;
    const distance = (x - cx) ** 2 + (y - cy) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestDir = zone.dir;
    }
  }
  return bestDir;
}
