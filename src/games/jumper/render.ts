import {
  DESIGN,
  SIZES,
  STARTING_LIVES,
  type JumperState,
  type NoteKind,
  type PickupKind,
  type PlatformSkin,
} from "./logic";

export interface JumperImages {
  cd: HTMLImageElement;
  drone: HTMLImageElement;
  heart_bonus: HTMLImageElement;
  heart_small: HTMLImageElement;
  hero: HTMLImageElement;
  micro: HTMLImageElement;
  note_cyan: HTMLImageElement;
  note_gold: HTMLImageElement;
  photocard: HTMLImageElement;
  photocard_cracked: HTMLImageElement;
  plat_cyan: HTMLImageElement;
  plat_pink: HTMLImageElement;
  speaker: HTMLImageElement;
}

type SpriteKey = NoteKind | PickupKind | PlatformSkin;

function aspect(image: HTMLImageElement, fallback = 1): number {
  return image.naturalWidth > 0
    ? image.naturalHeight / image.naturalWidth
    : fallback;
}

function screenY(state: JumperState, worldY: number): number {
  return DESIGN.h - (worldY - state.cameraY);
}

function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function drawHudBox(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
): void {
  g.save();
  g.fillStyle = "rgba(5, 1, 15, 0.84)";
  g.strokeStyle = "#ff4fd8";
  g.lineWidth = 2;
  g.shadowColor = "rgba(255, 79, 216, 0.55)";
  g.shadowBlur = 10;
  g.beginPath();
  g.roundRect(x, y, w, h, 12);
  g.fill();
  g.stroke();
  g.shadowBlur = 0;
  g.fillStyle = "#4ff0ff";
  g.font = "700 8px ui-monospace, monospace";
  g.textAlign = "left";
  g.textBaseline = "top";
  g.fillText(label.toUpperCase(), x + 9, y + 6);
  g.fillStyle = "#fff";
  g.font = "900 15px ui-monospace, monospace";
  g.fillText(value, x + 9, y + 18, w - 18);
  g.restore();
}

export function renderJumper(
  g: CanvasRenderingContext2D,
  state: JumperState,
  images: JumperImages,
  t: (key: string) => string,
): void {
  const gradient = g.createLinearGradient(0, 0, 0, DESIGN.h);
  gradient.addColorStop(0, "#241046");
  gradient.addColorStop(0.6, "#170a30");
  gradient.addColorStop(1, "#0a0318");
  g.fillStyle = gradient;
  g.fillRect(0, 0, DESIGN.w, DESIGN.h);

  // Deterministic parallax stars — presentation consumes no run RNG.
  for (let i = 0; i < 40; i += 1) {
    const x = (((i * 173) % 997) / 997) * DESIGN.w;
    let y =
      ((((i * 389) % 991) / 991) * DESIGN.h * 1.4 + state.cameraY * 0.25) %
      (DESIGN.h * 1.4);
    if (y < 0) y += DESIGN.h * 1.4;
    y = DESIGN.h - y;
    const size = 1 + (i % 3);
    g.globalAlpha = 0.3 + (0.5 * ((i * 53) % 97)) / 97;
    g.fillStyle = i % 5 === 0 ? "#4ff0ff" : i % 7 === 0 ? "#ffd6f5" : "#ffffff";
    g.fillRect(x, y, size, size);
  }
  g.globalAlpha = 1;

  for (const note of state.notes) {
    if (note.got) continue;
    const y = screenY(state, note.y);
    if (y < -40 || y > DESIGN.h + 40) continue;
    const image = images[note.kind as SpriteKey];
    const pulse = 1 + 0.08 * Math.sin(state.elapsedMs / 260 + note.x);
    const width = SIZES.note * pulse;
    g.save();
    g.shadowColor = note.kind === "heart_small" ? "#ff4fd8" : "#4ff0ff";
    g.shadowBlur = 10;
    g.drawImage(
      image,
      note.x - width / 2,
      y - width / 2,
      width,
      width * aspect(image),
    );
    g.restore();
  }

  for (const pickup of state.pickups) {
    if (pickup.got) continue;
    const y = screenY(state, pickup.y);
    if (y < -60 || y > DESIGN.h + 60) continue;
    const image = images[pickup.kind as SpriteKey];
    const bob = Math.sin(state.elapsedMs / 300 + pickup.x) * 4;
    g.drawImage(
      image,
      pickup.x - SIZES.pickup / 2,
      y - SIZES.pickup / 2 + bob,
      SIZES.pickup,
      SIZES.pickup * aspect(image),
    );
  }

  for (const platform of state.platforms) {
    const y = screenY(state, platform.y);
    if (y < -80 || y > DESIGN.h + 80 || platform.state === 2) continue;
    const image =
      platform.type === "cd"
        ? images.cd
        : platform.type === "card"
          ? platform.state === 0
            ? images.photocard
            : images.photocard_cracked
          : images[platform.skin];
    const height = platform.width * aspect(image, 0.5);
    if (platform.type === "cd") {
      g.save();
      g.translate(platform.x, y + height * 0.3);
      g.rotate((state.elapsedMs / 900) * platform.vx * 0.6);
      g.drawImage(
        image,
        -platform.width / 2,
        -height * 0.3,
        platform.width,
        height,
      );
      g.restore();
    } else {
      g.drawImage(
        image,
        platform.x - platform.width / 2,
        y - height * 0.15,
        platform.width,
        height,
      );
    }
    if (platform.speaker) {
      const heightSpeaker = SIZES.speaker * aspect(images.speaker, 1.28);
      g.drawImage(
        images.speaker,
        platform.x - SIZES.speaker / 2,
        y - heightSpeaker + height * 0.06,
        SIZES.speaker,
        heightSpeaker,
      );
    }
  }

  for (const drone of state.drones) {
    const y = screenY(state, drone.y);
    if (y < -60 || y > DESIGN.h + 60) continue;
    const height = SIZES.drone * aspect(images.drone, 0.7);
    g.drawImage(
      images.drone,
      drone.currentX - SIZES.drone / 2,
      y - height / 2,
      SIZES.drone,
      height,
    );
  }

  const heroY = screenY(state, state.hero.y);
  const blink =
    state.invincibilitySteps > 0 &&
    Math.floor(state.invincibilitySteps / 6) % 2 === 0;
  if (!blink) {
    g.save();
    g.translate(state.hero.x, heroY - state.hero.h / 2);
    g.scale(state.hero.face, 1);
    g.drawImage(
      images.hero,
      -state.hero.w / 2,
      -state.hero.h / 2,
      state.hero.w,
      state.hero.h,
    );
    g.restore();
  }

  // Original four-field HUD, compressed to preserve mobile play space.
  drawHudBox(g, 10, 10, 79, 43, t("game.jumper.hud.rank"), `#${state.rank}`);
  drawHudBox(g, 95, 10, 79, 43, t("game.jumper.hud.score"), `${state.score}`);
  drawHudBox(
    g,
    180,
    10,
    80,
    43,
    t("game.jumper.hud.time"),
    formatTime(state.elapsedMs),
  );
  drawHudBox(
    g,
    266,
    10,
    84,
    43,
    t("game.jumper.hud.lives"),
    `${"♥".repeat(state.lives)}${"·".repeat(STARTING_LIVES - state.lives)}`,
  );

  // CRT/vignette treatment from the delivery, without DOM overlays.
  g.fillStyle = "rgba(0, 0, 0, 0.08)";
  for (let y = 0; y < DESIGN.h; y += 4) g.fillRect(0, y, DESIGN.w, 2);
  const vignette = g.createRadialGradient(
    DESIGN.w / 2,
    DESIGN.h / 2,
    DESIGN.w * 0.25,
    DESIGN.w / 2,
    DESIGN.h / 2,
    DESIGN.h * 0.64,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.42)");
  g.fillStyle = vignette;
  g.fillRect(0, 0, DESIGN.w, DESIGN.h);
}
