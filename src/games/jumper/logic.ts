/**
 * Comeback Climb — deterministic port of DaiDai's delivered game.
 *
 * World altitude grows upward. The hero's `y` is the bottom/landing
 * anchor used by the delivery. All mechanical randomness comes from the
 * run seed; presentation never changes the simulation stream.
 */

export const DESIGN = { w: 360, h: 640 } as const;
export const STEP_MS = 1000 / 60;
export const TOTAL_RANKS = 99;
export const RANK_HEIGHT = DESIGN.h * 0.42;
export const TUTORIAL_UNTIL_RANK = 90;
export const JUMP_HEIGHT = DESIGN.h * 0.3;
export const GRAVITY = DESIGN.h * 0.0016;
export const HORIZONTAL_ACCEL = DESIGN.w * 0.002;
export const HORIZONTAL_MAX = DESIGN.w * 0.015;
export const HORIZONTAL_FRICTION = 0.93;
export const PLATFORM_REACH = DESIGN.w * 0.42;
export const SPEAKER_BOUNCE = 1.65;
export const STARTING_LIVES = 3;
export const SCORE_PER_RANK = 10;
export const RESPAWN_INVINCIBILITY_STEPS = 150;
export const RESPAWN_DELAY_MS = 700;
export const MAX_SCORE = 2490;

export const SIZES = {
  hero: DESIGN.w * 0.125,
  neon: DESIGN.w * 0.225,
  cd: DESIGN.w * 0.155,
  card: DESIGN.w * 0.16,
  drone: DESIGN.w * 0.115,
  speaker: DESIGN.w * 0.085,
  pickup: DESIGN.w * 0.125,
  note: DESIGN.w * 0.075,
} as const;

export type Rng = () => number;
export type PlatformType = "neon" | "cd" | "card";
export type PlatformSkin = "plat_pink" | "plat_cyan";
export type NoteKind = "note_cyan" | "note_gold" | "heart_small";
export type PickupKind = "micro" | "heart_bonus";
export type JumperStatus = "playing" | "respawning" | "lost" | "won";

export interface DifficultyZone {
  until: number;
  gapMin: number;
  gapMax: number;
  moving: number;
  breakable: number;
  droneEvery: number;
  cdSpeed: number;
}

export const ZONES: readonly DifficultyZone[] = [
  {
    until: 50,
    gapMin: 0.13,
    gapMax: 0.175,
    moving: 0.06,
    breakable: 0.06,
    droneEvery: 0,
    cdSpeed: 0.7,
  },
  {
    until: 10,
    gapMin: 0.15,
    gapMax: 0.2,
    moving: 0.18,
    breakable: 0.15,
    droneEvery: 3.2,
    cdSpeed: 1,
  },
  {
    until: 1,
    gapMin: 0.16,
    gapMax: 0.225,
    moving: 0.26,
    breakable: 0.2,
    droneEvery: 2.4,
    cdSpeed: 1.4,
  },
] as const;

export interface Hero {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  face: -1 | 1;
}

export interface Platform {
  x: number;
  y: number;
  type: PlatformType;
  width: number;
  state: 0 | 1 | 2;
  vx: number;
  speaker: boolean;
  skin: PlatformSkin;
}

export interface Drone {
  x: number;
  currentX: number;
  y: number;
  amplitude: number;
  phase: number;
  speed: number;
}

export interface Pickup {
  x: number;
  y: number;
  kind: PickupKind;
  got: boolean;
}

export interface Note {
  x: number;
  y: number;
  kind: NoteKind;
  got: boolean;
}

export interface JumperInput {
  left: boolean;
  right: boolean;
}

export interface JumperEvents {
  bounce?: "normal" | "speaker";
  scoreChanged?: boolean;
  collected?: NoteKind | PickupKind;
  hit?: boolean;
  respawned?: boolean;
  zoneChanged?: boolean;
  ended?: "lost" | "completed";
}

export interface JumperState {
  hero: Hero;
  platforms: Platform[];
  drones: Drone[];
  pickups: Pickup[];
  notes: Note[];
  cameraY: number;
  maxClimb: number;
  rank: number;
  score: number;
  lives: number;
  elapsedMs: number;
  magnetSteps: number;
  invincibilitySteps: number;
  respawnMs: number;
  status: JumperStatus;
  generatedY: number;
  lastPickupY: number;
  lastDroneY: number;
  zoneIndex: number;
}

const TUTORIAL_GAP = { min: 0.13, max: 0.165 } as const;
const SPEAKER_RATE = 0.06;
const PICKUP_EVERY_SCREENS = 2.8;
const NOTE_RATE_PER_SCREEN = 2.2;
const MAGNET_STEPS = 360;
const FULL_LIFE_BONUS = 50;
const NOTE_VALUES: Record<NoteKind, number> = {
  note_cyan: 5,
  note_gold: 10,
  heart_small: 20,
};

function randomBetween(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function zoneIndexForRank(rank: number): number {
  return rank > 50 ? 0 : rank > 10 ? 1 : 2;
}

export function rankAtAltitude(y: number): number {
  return Math.max(1, 100 - Math.floor(y / RANK_HEIGHT));
}

export function platformWidth(type: PlatformType): number {
  if (type === "cd") return SIZES.cd;
  if (type === "card") return SIZES.card;
  return SIZES.neon;
}

function addScore(state: JumperState, amount: number): void {
  state.score = Math.min(MAX_SCORE, state.score + amount);
}

function addPlatform(state: JumperState, y: number, rng: Rng): Platform {
  const rank = rankAtAltitude(y);
  const tutorial = rank > TUTORIAL_UNTIL_RANK;
  const zone = ZONES[zoneIndexForRank(rank)];
  const previous = state.platforms.at(-1);
  const previousType = previous?.type ?? "neon";
  const roll = rng();
  let type: PlatformType = "neon";
  if (!tutorial) {
    if (roll < zone.breakable && previousType !== "card") type = "card";
    else if (roll < zone.breakable + zone.moving) type = "cd";
  }
  const width = platformWidth(type);
  const x = previous
    ? Math.max(
        width / 2,
        Math.min(
          DESIGN.w - width / 2,
          previous.x + randomBetween(rng, -PLATFORM_REACH, PLATFORM_REACH),
        ),
      )
    : DESIGN.w / 2;
  const platform: Platform = {
    x,
    y,
    type,
    width,
    state: 0,
    vx:
      type === "cd"
        ? (rng() < 0.5 ? -1 : 1) * zone.cdSpeed * (DESIGN.w / 420)
        : 0,
    speaker: type === "neon" && rng() < SPEAKER_RATE,
    skin: rng() < 0.5 ? "plat_pink" : "plat_cyan",
  };
  state.platforms.push(platform);

  const noteProbability =
    NOTE_RATE_PER_SCREEN * (ZONES[0].gapMin + ZONES[0].gapMax) * 0.5;
  if (rng() < noteProbability) {
    const kindRoll = rng();
    const kind: NoteKind =
      kindRoll < 0.3 ? "heart_small" : rng() < 0.5 ? "note_gold" : "note_cyan";
    state.notes.push({
      x: Math.max(
        20,
        Math.min(
          DESIGN.w - 20,
          x + randomBetween(rng, -DESIGN.w * 0.2, DESIGN.w * 0.2),
        ),
      ),
      y: y - DESIGN.h * randomBetween(rng, 0.06, 0.12),
      kind,
      got: false,
    });
  }
  return platform;
}

function generateAhead(state: JumperState, rng: Rng): void {
  while (state.generatedY < state.cameraY + DESIGN.h * 1.6) {
    const nextRank = rankAtAltitude(state.generatedY);
    const tutorial = nextRank > TUTORIAL_UNTIL_RANK;
    const zone = ZONES[zoneIndexForRank(nextRank)];
    state.generatedY +=
      DESIGN.h *
      randomBetween(
        rng,
        tutorial ? TUTORIAL_GAP.min : zone.gapMin,
        tutorial ? TUTORIAL_GAP.max : zone.gapMax,
      );
    addPlatform(state, state.generatedY, rng);

    if (
      zone.droneEvery > 0 &&
      state.generatedY - state.lastDroneY > DESIGN.h * zone.droneEvery
    ) {
      state.lastDroneY = state.generatedY;
      const x = randomBetween(rng, DESIGN.w * 0.2, DESIGN.w * 0.8);
      state.drones.push({
        x,
        currentX: x,
        y: state.generatedY + DESIGN.h * randomBetween(rng, 0.05, 0.12),
        amplitude: randomBetween(rng, DESIGN.w * 0.15, DESIGN.w * 0.35),
        phase: randomBetween(rng, 0, Math.PI * 2),
        speed: randomBetween(rng, 0.6, 1.1),
      });
    }

    if (
      state.generatedY - state.lastPickupY >
      DESIGN.h * PICKUP_EVERY_SCREENS
    ) {
      state.lastPickupY = state.generatedY;
      state.pickups.push({
        x: randomBetween(rng, DESIGN.w * 0.2, DESIGN.w * 0.8),
        y: state.generatedY + DESIGN.h * 0.08,
        kind: rng() < 0.5 ? "micro" : "heart_bonus",
        got: false,
      });
    }
  }
}

export function bounceVelocity(multiplier = 1): number {
  return -Math.sqrt(2 * GRAVITY * JUMP_HEIGHT) * multiplier;
}

export function createJumperState(rng: Rng): JumperState {
  const heroWidth = SIZES.hero;
  const state: JumperState = {
    hero: {
      x: DESIGN.w / 2,
      y: 0,
      vx: 0,
      vy: bounceVelocity(),
      w: heroWidth,
      h: heroWidth * 1.29,
      face: 1,
    },
    platforms: [],
    drones: [],
    pickups: [],
    notes: [],
    cameraY: -DESIGN.h * 0.8,
    maxClimb: 0,
    rank: 100,
    score: 0,
    lives: STARTING_LIVES,
    elapsedMs: 0,
    magnetSteps: 0,
    invincibilitySteps: 0,
    respawnMs: 0,
    status: "playing",
    generatedY: 0,
    lastPickupY: 0,
    lastDroneY: 0,
    zoneIndex: 0,
  };
  const start = addPlatform(state, 0, rng);
  start.x = DESIGN.w / 2;
  start.type = "neon";
  start.width = SIZES.neon;
  start.speaker = false;
  generateAhead(state, rng);
  return state;
}

/**
 * Invisible mobile thumb zones: the inner quarters give a small nudge;
 * the outer quarters give a stronger impulse. No visual controls cover
 * the playfield.
 */
export function thumbImpulseAt(x: number): number {
  const clamped = Math.max(0, Math.min(DESIGN.w, x));
  const direction = clamped < DESIGN.w / 2 ? -1 : 1;
  const distanceFromCenter = Math.abs(clamped - DESIGN.w / 2);
  const magnitude =
    distanceFromCenter < DESIGN.w / 4
      ? HORIZONTAL_MAX * 0.42
      : HORIZONTAL_MAX * 0.9;
  return direction * magnitude;
}

export function applyThumbImpulse(state: JumperState, x: number): void {
  if (state.status !== "playing") return;
  const impulse = thumbImpulseAt(x);
  state.hero.vx = Math.max(
    -HORIZONTAL_MAX,
    Math.min(HORIZONTAL_MAX, state.hero.vx + impulse),
  );
  state.hero.face = impulse < 0 ? -1 : 1;
}

function safeRespawn(state: JumperState): void {
  const candidates = state.platforms.filter(
    (platform) =>
      platform.state !== 2 &&
      platform.type !== "card" &&
      platform.y > state.cameraY + DESIGN.h * 0.25 &&
      platform.y < state.cameraY + DESIGN.h * 0.75,
  );
  const target =
    candidates[Math.floor(candidates.length / 2)] ??
    state.platforms
      .filter((platform) => platform.state !== 2)
      .sort(
        (a, b) =>
          Math.abs(a.y - (state.cameraY + DESIGN.h * 0.5)) -
          Math.abs(b.y - (state.cameraY + DESIGN.h * 0.5)),
      )[0];
  if (target) {
    state.hero.x = target.x;
    state.hero.y = target.y;
  }
  state.hero.vx = 0;
  state.invincibilitySteps = RESPAWN_INVINCIBILITY_STEPS;
  state.respawnMs = RESPAWN_DELAY_MS;
  state.status = "respawning";
}

function loseLife(state: JumperState, events: JumperEvents): void {
  state.lives -= 1;
  events.hit = true;
  if (state.lives <= 0) {
    state.status = "lost";
    events.ended = "lost";
    return;
  }
  safeRespawn(state);
}

function collect(state: JumperState, events: JumperEvents): void {
  const hero = state.hero;
  for (const pickup of state.pickups) {
    if (
      pickup.got ||
      Math.abs(hero.x - pickup.x) >= DESIGN.w * 0.105 ||
      Math.abs(hero.y + hero.h / 2 - pickup.y) >= DESIGN.w * 0.115
    ) {
      continue;
    }
    pickup.got = true;
    events.collected = pickup.kind;
    if (pickup.kind === "micro") state.magnetSteps = MAGNET_STEPS;
    else if (state.lives < STARTING_LIVES) state.lives += 1;
    else addScore(state, FULL_LIFE_BONUS);
    events.scoreChanged = true;
  }

  for (const note of state.notes) {
    if (note.got) continue;
    if (state.magnetSteps > 0) {
      const dx = hero.x - note.x;
      const dy = hero.y + hero.h / 2 - note.y;
      if (dx * dx + dy * dy < (DESIGN.w * 0.5) ** 2) {
        note.x += dx * 0.09;
        note.y += dy * 0.09;
      }
    }
    if (
      Math.abs(hero.x - note.x) < DESIGN.w * 0.085 &&
      Math.abs(hero.y + hero.h / 2 - note.y) < DESIGN.w * 0.095
    ) {
      note.got = true;
      addScore(state, NOTE_VALUES[note.kind]);
      events.collected = note.kind;
      events.scoreChanged = true;
    }
  }
  if (state.magnetSteps > 0) state.magnetSteps -= 1;
}

/** One fixed 60Hz step. */
export function step(
  state: JumperState,
  input: JumperInput,
  rng: Rng,
): JumperEvents {
  const events: JumperEvents = {};
  if (state.status === "lost" || state.status === "won") return events;
  state.elapsedMs += STEP_MS;
  if (state.status === "respawning") {
    state.respawnMs = Math.max(0, state.respawnMs - STEP_MS);
    if (state.respawnMs < 0.001) state.respawnMs = 0;
    if (state.respawnMs === 0) {
      state.status = "playing";
      state.hero.vy = bounceVelocity();
      events.respawned = true;
      events.bounce = "normal";
    }
    return events;
  }

  const hero = state.hero;
  if (input.left) {
    hero.vx -= HORIZONTAL_ACCEL;
    hero.face = -1;
  }
  if (input.right) {
    hero.vx += HORIZONTAL_ACCEL;
    hero.face = 1;
  }
  hero.vx *= HORIZONTAL_FRICTION;
  hero.vx = Math.max(-HORIZONTAL_MAX, Math.min(HORIZONTAL_MAX, hero.vx));
  hero.x += hero.vx;
  if (hero.x < -hero.w / 2) hero.x = DESIGN.w + hero.w / 2;
  if (hero.x > DESIGN.w + hero.w / 2) hero.x = -hero.w / 2;

  hero.vy += GRAVITY;
  hero.y -= hero.vy;

  if (hero.vy > 0) {
    for (const platform of state.platforms) {
      if (platform.state === 2) continue;
      const previousBottom = hero.y + hero.vy;
      if (
        hero.x > platform.x - platform.width / 2 - hero.w * 0.2 &&
        hero.x < platform.x + platform.width / 2 + hero.w * 0.2 &&
        previousBottom >= platform.y &&
        hero.y <= platform.y
      ) {
        hero.y = platform.y;
        if (platform.type === "card") {
          if (platform.state === 0) {
            platform.state = 1;
            hero.vy = bounceVelocity();
            events.bounce = "normal";
          } else {
            platform.state = 2;
            continue;
          }
        } else if (platform.speaker) {
          hero.vy = bounceVelocity(SPEAKER_BOUNCE);
          events.bounce = "speaker";
        } else {
          hero.vy = bounceVelocity();
          events.bounce = "normal";
        }
        break;
      }
    }
  }

  if (hero.y > state.maxClimb) {
    state.maxClimb = hero.y;
    const nextRank = rankAtAltitude(state.maxClimb);
    if (nextRank < state.rank) {
      addScore(state, (state.rank - nextRank) * SCORE_PER_RANK);
      state.rank = nextRank;
      events.scoreChanged = true;
      const nextZone = zoneIndexForRank(state.rank);
      if (nextZone > state.zoneIndex) {
        state.zoneIndex = nextZone;
        events.zoneChanged = true;
      }
      if (state.rank <= 1) {
        state.status = "won";
        events.ended = "completed";
        return events;
      }
    }
  }

  const heroScreenY = DESIGN.h - (hero.y - state.cameraY);
  if (heroScreenY < DESIGN.h * 0.45) {
    state.cameraY = hero.y - DESIGN.h * 0.55;
  }
  generateAhead(state, rng);

  for (const platform of state.platforms) {
    if (platform.type !== "cd") continue;
    platform.x += platform.vx;
    if (
      platform.x < platform.width / 2 ||
      platform.x > DESIGN.w - platform.width / 2
    ) {
      platform.vx *= -1;
    }
  }

  const seconds = state.elapsedMs / 1000;
  for (const drone of state.drones) {
    drone.currentX =
      drone.x + Math.sin(seconds * drone.speed + drone.phase) * drone.amplitude;
  }
  if (state.invincibilitySteps <= 0) {
    for (const drone of state.drones) {
      if (
        Math.abs(hero.x - drone.currentX) < hero.w * 0.45 + DESIGN.w * 0.06 &&
        Math.abs(hero.y + hero.h / 2 - drone.y) < hero.h * 0.4 + DESIGN.w * 0.04
      ) {
        loseLife(state, events);
        return events;
      }
    }
  } else {
    state.invincibilitySteps -= 1;
  }

  collect(state, events);
  if (hero.y < state.cameraY - DESIGN.h * 0.05) {
    loseLife(state, events);
    return events;
  }

  const pruneBelow = state.cameraY - DESIGN.h;
  state.platforms = state.platforms.filter((item) => item.y > pruneBelow);
  state.drones = state.drones.filter((item) => item.y > pruneBelow);
  state.pickups = state.pickups.filter(
    (item) => !item.got && item.y > pruneBelow,
  );
  state.notes = state.notes.filter((item) => !item.got && item.y > pruneBelow);
  return events;
}
