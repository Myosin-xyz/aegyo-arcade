/**
 * Comeback Climb — pure, deterministic rules (docs/games/jumper.md).
 *
 * Adopted M2 units, per fixed 60Hz step: gravity 0.32 px/step², bounce
 * impulse −9.5 px/step, steering x += clamp((steerX − x) · 0.15, ±8),
 * platform width 64, seeded spawn dy ∈ [55, 85] with |dx| ≤ 140 from the
 * previous platform (guaranteed reachable under the movement limits),
 * camera follows upward only, loss when the player falls 640 px below
 * the camera top. Rank: #100 − climbed; #1 (climbed 99) completes.
 */

export const DESIGN = { w: 360, h: 640 } as const;
export const GRAVITY = 0.32;
export const BOUNCE_IMPULSE = -9.5;
export const STEER_FACTOR = 0.15;
export const STEER_MAX = 8;
export const PLATFORM_W = 64;
export const PLATFORM_H = 10;
export const PLAYER_W = 30;
export const PLAYER_H = 28;
export const SPAWN_DY_MIN = 55;
export const SPAWN_DY_MAX = 85;
export const SPAWN_DX_MAX = 140;
export const CAMERA_LEAD = 220;
export const MAX_CLIMB = 99; // #100 → #1

export interface Platform {
  x: number;
  y: number;
  credited: boolean;
}

export interface JumperState {
  x: number;
  y: number;
  vy: number;
  steerX: number;
  cameraY: number;
  platforms: Platform[];
  climbed: number;
  status: "running" | "lost" | "completed";
}

function clampX(x: number): number {
  return Math.min(Math.max(x, 10), DESIGN.w - PLATFORM_W - 10);
}

/** Seeded next platform, reachable from the previous one (docs edge). */
export function nextPlatform(previous: Platform, rng: () => number): Platform {
  const dy = SPAWN_DY_MIN + rng() * (SPAWN_DY_MAX - SPAWN_DY_MIN);
  const dx = (rng() * 2 - 1) * SPAWN_DX_MAX;
  return { x: clampX(previous.x + dx), y: previous.y - dy, credited: false };
}

export function createJumperState(rng: () => number): JumperState {
  const platforms: Platform[] = [
    // Guaranteed start platform directly under the player.
    { x: DESIGN.w / 2 - PLATFORM_W / 2, y: 500, credited: true },
  ];
  while (platforms.length < 8) {
    platforms.push(nextPlatform(platforms[platforms.length - 1], rng));
  }
  return {
    x: DESIGN.w / 2 - PLAYER_W / 2,
    y: 500 - PLAYER_H,
    vy: BOUNCE_IMPULSE,
    steerX: DESIGN.w / 2 - PLAYER_W / 2,
    cameraY: 0,
    platforms,
    climbed: 0,
    status: "running",
  };
}

export function steer(state: JumperState, targetX: number): void {
  if (state.status !== "running") return;
  state.steerX = Math.min(Math.max(targetX, 0), DESIGN.w - PLAYER_W);
}

export function rankOf(state: JumperState): number {
  return 100 - state.climbed;
}

/** One fixed step in WORLD coordinates; the camera never affects physics. */
export function step(state: JumperState, rng: () => number): void {
  if (state.status !== "running") return;

  const previousY = state.y;
  state.vy += GRAVITY;
  state.y += state.vy;
  const steerDelta = (state.steerX - state.x) * STEER_FACTOR;
  state.x += Math.min(Math.max(steerDelta, -STEER_MAX), STEER_MAX);

  // Landing: falling, feet cross a platform top this step, horizontal
  // overlap. Side/bottom contacts never count (docs rule edge).
  if (state.vy > 0) {
    const feetBefore = previousY + PLAYER_H;
    const feetAfter = state.y + PLAYER_H;
    for (const platform of state.platforms) {
      if (
        feetBefore <= platform.y &&
        feetAfter >= platform.y &&
        state.x + PLAYER_W > platform.x &&
        state.x < platform.x + PLATFORM_W
      ) {
        state.y = platform.y - PLAYER_H;
        state.vy = BOUNCE_IMPULSE;
        if (!platform.credited) {
          platform.credited = true;
          state.climbed += 1;
          if (state.climbed >= MAX_CLIMB) {
            state.status = "completed";
            return;
          }
        }
        break;
      }
    }
  }

  // Camera follows UP only.
  if (state.y - state.cameraY < CAMERA_LEAD) {
    state.cameraY = state.y - CAMERA_LEAD;
  }

  // Spawn ahead / drop far-below platforms (world-space bookkeeping).
  while (state.platforms.length < 12) {
    state.platforms.push(
      nextPlatform(state.platforms[state.platforms.length - 1], rng),
    );
  }
  state.platforms = state.platforms.filter(
    (platform) => platform.y - state.cameraY < DESIGN.h + 60,
  );

  // Loss boundary is camera-relative by design (docs: falling below the
  // camera's loss boundary) — the only camera-coupled rule.
  if (state.y - state.cameraY > DESIGN.h) {
    state.status = "lost";
  }
}
