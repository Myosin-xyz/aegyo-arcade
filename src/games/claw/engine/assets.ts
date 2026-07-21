import type { Manifest, SpriteRect } from "./types";

export interface ImageBank {
  get(rect: SpriteRect): HTMLImageElement;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

/** Controls the input layer + render blit unconditionally. */
export const REQUIRED_CONTROLS = [
  "left",
  "right",
  "forward",
  "backward",
  "drop",
] as const;
/** Union of engine.ts FRONT_ROW + BACK_ROW — every aimable plush. Keep
 * in sync if those rows change (validated here so a drifted/stale-cached
 * manifest fails LOUD at load instead of silently redirecting aim to a
 * different plush or throwing deep inside the rAF frame — audit
 * silent-failure #4, 2026-07-21). */
export const REQUIRED_PLUSH = ["D", "A", "E", "B", "K", "A2"] as const;

export async function fetchManifest(base: string): Promise<Manifest> {
  const res = await fetch(`${base}manifest.json`);
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  const m = (await res.json()) as Manifest;
  for (const k of REQUIRED_CONTROLS) {
    if (!m.controls?.[k]) throw new Error(`manifest missing control "${k}"`);
  }
  for (const k of REQUIRED_PLUSH) {
    if (!m.clawPlush?.[k]) throw new Error(`manifest missing plush "${k}"`);
  }
  return m;
}

export async function loadImages(
  base: string,
  m: Manifest,
  onProgress?: (p: number) => void,
): Promise<ImageBank> {
  const rects: SpriteRect[] = [
    m.back,
    m.frontPlush,
    m.frame,
    m.trolley,
    m.clawOpen,
    m.clawClosed,
    m.winBoard,
    ...Object.values(m.clawPlush),
    ...Object.values(m.controls),
  ];
  const srcs = [...new Set(rects.map((r) => r.src))];
  const images = new Map<string, HTMLImageElement>();
  let done = 0;
  await Promise.all(
    srcs.map(async (src) => {
      images.set(src, await loadImage(`${base}${src}`));
      done += 1;
      onProgress?.(done / srcs.length);
    }),
  );
  return {
    get(rect) {
      const img = images.get(rect.src);
      if (!img) throw new Error(`missing image ${rect.src}`);
      return img;
    },
  };
}
