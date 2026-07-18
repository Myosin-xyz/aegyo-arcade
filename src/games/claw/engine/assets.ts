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

export async function fetchManifest(base: string): Promise<Manifest> {
  const res = await fetch(`${base}manifest.json`);
  if (!res.ok) throw new Error(`manifest ${res.status}`);
  return (await res.json()) as Manifest;
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
